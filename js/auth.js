/**
 * SISTEMA DE AGENDAMENTO DE AUDITÓRIOS - CENTRAL DE AULAS (PRG / UFPB)
 * Serviço de Autenticação e Controle de Acesso (RBAC)
 * Autenticação por Matrícula SIAPE e Senha Institucional
 * Gestor Único: Hidelbrando Diógenes (SIAPE 1046483)
 */

class AuthService {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  init() {
    // Carrega sessão salva no sessionStorage
    const saved = sessionStorage.getItem("prg_current_user");
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (e) {
        this.currentUser = null;
      }
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isLoggedIn() {
    return !!this.currentUser;
  }

  isGestor(user = this.currentUser) {
    if (!user) return false;
    const s = String(user.siape || "").trim();
    if (s === "1046483") return true;
    return user.perfil === "gestor" || user.perfil === "admin";
  }

  isUsuario(user = this.currentUser) {
    if (!user) return false;
    return user.perfil === "usuario" || user.perfil === "operador" || this.isGestor(user);
  }

  // Compatibilidade com código legado
  isMasterAdmin(user = this.currentUser) {
    return this.isGestor(user);
  }

  isAdmin(user = this.currentUser) {
    return this.isGestor(user);
  }

  isOperator(user = this.currentUser) {
    return this.isUsuario(user);
  }

  hasPermission(permissionName, user = this.currentUser) {
    if (!user) return false;
    if (this.isGestor(user)) return true;
    return !!(user.permissoes && user.permissoes[permissionName]);
  }

  canApprove(user = this.currentUser) {
    return this.hasPermission("aprovar", user);
  }

  canManageChecklist(user = this.currentUser) {
    return this.hasPermission("checklist", user);
  }

  canManageBlocks(user = this.currentUser) {
    return this.hasPermission("bloqueio", user);
  }

  canManageUsers(user = this.currentUser) {
    return this.hasPermission("usuarios", user) || this.isGestor(user);
  }

  canEditBooking(booking, user = this.currentUser) {
    if (!this.isLoggedIn()) return false;
    return this.canApprove(user);
  }

  canAssignAdminRole(user = this.currentUser) {
    return this.isMasterAdmin(user);
  }

  /**
   * Autenticação Oficial por Matrícula SIAPE e Senha
   */
  async loginWithSiape(siapeInput, senhaInput) {
    const siape = String(siapeInput || "").trim().replace(/\D/g, "");
    const senha = String(senhaInput || "").trim();

    if (!siape) {
      throw new Error("Informe sua matrícula SIAPE para acessar o sistema.");
    }
    if (!senha) {
      throw new Error("Informe sua senha de acesso institucional.");
    }

    const usuarios = await window.storageService.getUsuarios();
    let user = usuarios.find(u => String(u.siape || "").replace(/\D/g, "") === siape);

    // Auto-recuperação do Gestor Único se for o SIAPE 1046483
    if (siape === "1046483") {
      const gestorCustomPwd = localStorage.getItem("prg_pwd_1046483");
      if (!user) {
        user = {
          id: "usr_gestor_hidelbrando",
          nome: "Hidelbrando Diógenes",
          siape: "1046483",
          email: "hjfd@academico.ufpb.br",
          setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
          cargo: "Gestor",
          perfil: "gestor",
          permissoes: { aprovar: true, checklist: true, bloqueio: true, usuarios: true },
          status: "ativo",
          senha: gestorCustomPwd || "ufpb123",
          primeiroAcesso: !gestorCustomPwd
        };
        try {
          const list = JSON.parse(localStorage.getItem("prg_usuarios") || "[]");
          list.unshift(user);
          localStorage.setItem("prg_usuarios", JSON.stringify(list));
        } catch (e) {}
      } else {
        user.perfil = "gestor";
        user.cargo = "Gestor";
        user.nome = "Hidelbrando Diógenes";
        user.status = "ativo";
        user.permissoes = { aprovar: true, checklist: true, bloqueio: true, usuarios: true };
        if (gestorCustomPwd) {
          user.senha = gestorCustomPwd;
          user.primeiroAcesso = false;
        }
      }
    }

    // Auto-recuperação do Servidor Álvaro se for o SIAPE 1349975
    if (siape === "1349975") {
      const alvaroCustomPwd = localStorage.getItem("prg_pwd_1349975");
      if (!user) {
        user = {
          id: "usr_alvaro_1349975",
          nome: "Álvaro",
          siape: "1349975",
          email: "alvaro@ufpb.br",
          setor: "PRG / UFPB",
          cargo: "Usuário",
          perfil: "usuario",
          permissoes: { aprovar: true, checklist: true, bloqueio: false, usuarios: false },
          status: "ativo",
          senha: alvaroCustomPwd || "ufpb123",
          primeiroAcesso: !alvaroCustomPwd
        };
        try {
          const list = JSON.parse(localStorage.getItem("prg_usuarios") || "[]");
          list.push(user);
          localStorage.setItem("prg_usuarios", JSON.stringify(list));
        } catch (e) {}
      } else {
        user.perfil = "usuario";
        user.cargo = "Usuário";
        user.nome = user.nome || "Álvaro";
        user.status = "ativo";
        if (alvaroCustomPwd) {
          user.senha = alvaroCustomPwd;
          user.primeiroAcesso = false;
        }
      }
    }

    if (!user) {
      throw new Error(`A matrícula SIAPE ${siape} não foi localizada. Apenas servidores cadastrados pelo Gestor possuem acesso ao sistema.`);
    }

    if (user.status === "inativo") {
      throw new Error("Seu acesso está inativo no momento. Entre em contato com o Gestor (Hidelbrando Diógenes).");
    }

    // Validação Estrita da Senha (com persistência isolada por matrícula SIAPE)
    const savedCustomPwd = localStorage.getItem("prg_pwd_" + siape);
    const expectedPwd = savedCustomPwd || user.senha || "ufpb123";

    if (senha !== expectedPwd) {
      throw new Error("Senha incorreta. Verifique suas credenciais e tente novamente.");
    }

    const hasCustomPwd = !!savedCustomPwd;
    const isFirstAccess = !hasCustomPwd && (user.primeiroAcesso !== false || user.senha === "ufpb123");

    // Configuração do Usuário Autenticado
    this.currentUser = {
      id: user.id,
      nome: user.nome,
      siape: user.siape,
      email: user.email,
      setor: user.setor,
      perfil: (user.siape === "1046483" || user.perfil === "gestor") ? "gestor" : "usuario",
      cargo: (user.siape === "1046483" || user.perfil === "gestor") ? "Gestor" : "Usuário",
      permissoes: (user.siape === "1046483" || user.perfil === "gestor")
        ? { aprovar: true, checklist: true, bloqueio: true, usuarios: true }
        : (user.permissoes || { aprovar: true, checklist: false, bloqueio: false, usuarios: false }),
      status: user.status,
      primeiroAcesso: isFirstAccess
    };

    // Necessidade de troca de senha no primeiro acesso
    const needsPasswordChange = isFirstAccess;

    if (!needsPasswordChange) {
      sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
      window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
    }

    return { user: this.currentUser, needsPasswordChange };
  }

  /**
   * Alteração de Senha (Primeiro Acesso ou Alteração Voluntária)
   */
  async changePassword(newPassword) {
    if (!this.currentUser) {
      throw new Error("Nenhum usuário logado para alteração de senha.");
    }
    const clean = String(newPassword || "").trim();
    if (clean.length < 6) {
      throw new Error("A nova senha deve possuir pelo menos 6 caracteres.");
    }

    const siape = String(this.currentUser.siape || "").replace(/\D/g, "");
    if (siape) {
      localStorage.setItem("prg_pwd_" + siape, clean);
    }

    this.currentUser.senha = clean;
    this.currentUser.primeiroAcesso = false;

    await window.storageService.updateUsuarioSenha(siape || this.currentUser.id, clean);
    sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
    return this.currentUser;
  }

  /**
   * Login unificado
   */
  async login(siape, senha) {
    return await this.loginWithSiape(siape, senha);
  }

  async logout() {
    this.currentUser = null;
    sessionStorage.removeItem("prg_current_user");
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: null }));
  }

  // Atalho para teste rápido em demonstração
  async quickLogin(role = "admin") {
    return await this.login("1046483", "ufpb123");
  }
}

window.authService = new AuthService();
