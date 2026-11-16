/**
 * SISTEMA DE AGENDAMENTO DE AUDITÓRIOS - CENTRAL DE AULAS (PRG / UFPB)
 * Serviço de Autenticação e Controle de Acesso (RBAC)
 * Autenticação via Google Workspace (@academico.ufpb.br)
 * Gestor Principal: Prof. Dr. Hidelbrando Diógenes (hjfd@academico.ufpb.br)
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

    // Se Firebase estiver ativo, monitora estado da sessão
    if (window.isFirebaseActive && window.fbAuth) {
      window.fbAuth.onAuthStateChanged(async (user) => {
        if (user) {
          const email = (user.email || "").toLowerCase().trim();
          const isMaster = (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br");

          try {
            const doc = await window.fbDb.collection("usuarios").where("email", "==", email).limit(1).get();
            if (!doc.empty) {
              const uData = doc.docs[0].data();
              this.currentUser = {
                id: doc.docs[0].id,
                ...uData,
                isMasterAdmin: isMaster || !!uData.isMasterAdmin
              };
              sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
            } else if (isMaster) {
              // Master Admin auto-provision
              this.currentUser = {
                id: "usr_hjfd_principal",
                nome: user.displayName || "Prof. Dr. Hidelbrando Diógenes",
                email: "hjfd@academico.ufpb.br",
                setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
                cargo: "Gestor Principal da Agenda SisInfra",
                perfil: "admin",
                isMasterAdmin: true,
                status: "ativo"
              };
              sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
            }
          } catch (err) {
            console.error("Erro ao sincronizar perfil do Firebase:", err);
          }
        } else if (!saved) {
          this.currentUser = null;
        }
        window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
      });
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isLoggedIn() {
    return !!this.currentUser;
  }

  isMasterAdmin(user = this.currentUser) {
    if (!user) return false;
    const email = (user.email || "").toLowerCase().trim();
    return (
      user.isMasterAdmin === true ||
      email === "hjfd@academico.ufpb.br" ||
      email === "hjfd@cademico.ufpb.br"
    );
  }

  isAdmin(user = this.currentUser) {
    if (!user) return false;
    return this.isMasterAdmin(user) || user.perfil === "admin";
  }

  isOperator(user = this.currentUser) {
    if (!user) return false;
    return user.perfil === "operador" || this.isAdmin(user);
  }

  canEditBooking(booking) {
    if (!this.isLoggedIn()) return false;
    if (this.isAdmin()) return true;
    if (this.isOperator()) return true;
    return false;
  }

  canManageUsers(user = this.currentUser) {
    return this.isAdmin(user);
  }

  canAssignAdminRole(user = this.currentUser) {
    return this.isMasterAdmin(user);
  }

  /**
   * Login com Google Workspace institucional (@academico.ufpb.br)
   */
  async loginWithGoogle() {
    // 1. Firebase Auth Ativo
    if (window.isFirebaseActive && window.fbAuth && typeof firebase !== 'undefined') {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({
          hd: "academico.ufpb.br",
          prompt: "select_account"
        });

        const result = await window.fbAuth.signInWithPopup(provider);
        const fbUser = result.user;
        const email = (fbUser.email || "").toLowerCase().trim();

        // Validação estrita do domínio institucional
        if (!email.endsWith("@academico.ufpb.br") && email !== "hjfd@cademico.ufpb.br") {
          await window.fbAuth.signOut();
          const err = new Error("Acesso Negado: Somente contas institucionais da UFPB (@academico.ufpb.br) são permitidas.");
          err.code = "DOMAIN_NOT_ALLOWED";
          throw err;
        }

        const isMaster = (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br");

        let profile = null;
        try {
          const snap = await window.fbDb.collection("usuarios").where("email", "==", email).limit(1).get();
          if (!snap.empty) {
            profile = { id: snap.docs[0].id, ...snap.docs[0].data() };
          }
        } catch (dbErr) {
          console.warn("Aviso ao buscar perfil no Firestore:", dbErr);
        }

        // Se for o Gestor Principal e não estiver no Firestore, cria automaticamente
        if (isMaster) {
          if (!profile) {
            profile = {
              id: "usr_hjfd_principal",
              nome: fbUser.displayName || "Prof. Dr. Hidelbrando Diógenes",
              email: "hjfd@academico.ufpb.br",
              setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
              cargo: "Gestor Principal da Agenda SisInfra",
              perfil: "admin",
              isMasterAdmin: true,
              status: "ativo",
              criadoEm: new Date().toISOString()
            };
            try {
              await window.fbDb.collection("usuarios").doc(profile.id).set(profile);
            } catch (e) {
              console.error("Erro ao registrar Gestor Principal no Firestore:", e);
            }
          } else {
            profile.isMasterAdmin = true;
            profile.perfil = "admin";
            profile.status = "ativo";
          }
        }

        // Se outro usuário @academico.ufpb.br não estiver autorizado
        if (!profile) {
          await window.fbAuth.signOut();
          const notAuthErr = new Error(`Sua conta Google institucional (${email}) foi confirmada, mas ainda não possui autorização de acesso ao sistema.\n\nPara solicitar acesso, envie uma solicitação ao Gestor Principal (Prof. Dr. Hidelbrando Diógenes - hjfd@academico.ufpb.br).`);
          notAuthErr.code = "AUTH_NOT_AUTHORIZED";
          notAuthErr.userEmail = email;
          notAuthErr.userName = fbUser.displayName || email.split("@")[0];
          throw notAuthErr;
        }

        if (profile.status === "inativo") {
          await window.fbAuth.signOut();
          throw new Error("Seu acesso está inativo no momento. Entre em contato com a PRG / Central de Aulas.");
        }

        this.currentUser = {
          id: profile.id,
          nome: profile.nome || fbUser.displayName,
          email: profile.email,
          setor: profile.setor,
          perfil: profile.perfil,
          isMasterAdmin: isMaster || !!profile.isMasterAdmin,
          cargo: profile.cargo || (isMaster ? "Gestor Principal da Agenda SisInfra" : (profile.perfil === "admin" ? "Gestor SisInfra" : "Operador")),
          status: profile.status,
          photoURL: fbUser.photoURL || null
        };

        sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
        window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
        return this.currentUser;

      } catch (err) {
        console.error("Erro no login Google:", err);
        throw err;
      }
    }

    // 2. Modo Demonstração / LocalStorage (GitHub Pages / Offline)
    return await this.simulateGoogleLogin();
  }

  /**
   * Simulação de Login Google Institucional para testes em ambiente estático / offline
   */
  async simulateGoogleLogin(targetEmail = "hjfd@academico.ufpb.br") {
    let email = targetEmail.trim().toLowerCase();

    if (!email.includes("@")) {
      email = `${email}@academico.ufpb.br`;
    }

    if (!email.endsWith("@academico.ufpb.br") && email !== "hjfd@cademico.ufpb.br") {
      throw new Error("Acesso Negado: Somente e-mails com terminação @academico.ufpb.br são permitidos.");
    }

    const isMaster = (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br");

    const usuarios = await window.storageService.getUsuarios();
    let user = usuarios.find(u => (u.email || "").toLowerCase() === email);

    if (isMaster) {
      if (!user) {
        user = {
          id: "usr_hjfd_principal",
          nome: "Prof. Dr. Hidelbrando Diógenes",
          email: "hjfd@academico.ufpb.br",
          setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
          cargo: "Gestor Principal da Agenda SisInfra",
          perfil: "admin",
          isMasterAdmin: true,
          status: "ativo"
        };
        try {
          const localList = JSON.parse(localStorage.getItem("prg_usuarios") || "[]");
          localList.unshift(user);
          localStorage.setItem("prg_usuarios", JSON.stringify(localList));
        } catch (e) {}
      } else {
        user.isMasterAdmin = true;
        user.perfil = "admin";
        user.status = "ativo";
      }
    }

    if (!user) {
      const notAuthErr = new Error(`A conta institucional Google (${email}) é válida, mas você ainda não possui autorização no sistema. Solicite permissão ao Gestor Principal (Prof. Dr. Hidelbrando Diógenes).`);
      notAuthErr.code = "AUTH_NOT_AUTHORIZED";
      notAuthErr.userEmail = email;
      notAuthErr.userName = email.split("@")[0];
      throw notAuthErr;
    }

    if (user.status === "inativo") {
      throw new Error("Seu acesso está inativo no momento. Procure o Gestor Principal ou a PRG.");
    }

    this.currentUser = {
      id: user.id,
      nome: user.nome,
      email: user.email,
      setor: user.setor,
      perfil: user.perfil,
      isMasterAdmin: isMaster || !!user.isMasterAdmin,
      cargo: user.cargo || (isMaster ? "Gestor Principal da Agenda SisInfra" : (user.perfil === "admin" ? "Gestor SisInfra" : "Operador")),
      status: user.status
    };

    sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
    return this.currentUser;
  }

  /**
   * Login com E-mail e Senha institucional
   */
  async login(email, senha) {
    email = email.trim().toLowerCase();

    // Se o usuário digitou apenas o prefixo (sem @), completa automaticamente com @academico.ufpb.br
    if (!email.includes("@")) {
      email = `${email}@academico.ufpb.br`;
    }

    if (!email.endsWith("@academico.ufpb.br") && email !== "hjfd@cademico.ufpb.br") {
      throw new Error("Acesso restrito! O login deve ser realizado com uma conta do domínio institucional @academico.ufpb.br.");
    }

    const isMaster = (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br");

    // 1. Tenta login no Firebase se ativo
    if (window.isFirebaseActive && window.fbAuth) {
      try {
        const userCred = await window.fbAuth.signInWithEmailAndPassword(email, senha);
        const snap = await window.fbDb.collection("usuarios").where("email", "==", email).limit(1).get();
        if (!snap.empty) {
          const profile = { id: snap.docs[0].id, ...snap.docs[0].data() };
          if (profile.status === "inativo") {
            await window.fbAuth.signOut();
            throw new Error("Seu acesso foi desativado pela coordenação da Central de Aulas.");
          }
          this.currentUser = {
            ...profile,
            isMasterAdmin: isMaster || !!profile.isMasterAdmin
          };
          sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
          window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
          return this.currentUser;
        }
      } catch (firebaseErr) {
        console.warn("Falha no login do Firebase:", firebaseErr);
        throw new Error(this.translateFirebaseError(firebaseErr.code) || firebaseErr.message);
      }
    }

    // 2. Fallback / Modo Demonstração (LocalStorage)
    const usuarios = await window.storageService.getUsuarios();
    let user = usuarios.find(u => (u.email || "").toLowerCase() === email);

    if (isMaster && !user) {
      user = {
        id: "usr_hjfd_principal",
        nome: "Prof. Dr. Hidelbrando Diógenes",
        email: "hjfd@academico.ufpb.br",
        setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
        cargo: "Gestor Principal da Agenda SisInfra",
        perfil: "admin",
        isMasterAdmin: true,
        status: "ativo",
        senha: "admin123"
      };
      try {
        const localList = JSON.parse(localStorage.getItem("prg_usuarios") || "[]");
        localList.unshift(user);
        localStorage.setItem("prg_usuarios", JSON.stringify(localList));
      } catch (e) {}
    }

    if (!user) {
      throw new Error("Usuário não autorizado. Para ter acesso liberado, solicite cadastro ao Gestor Principal (Prof. Dr. Hidelbrando Diógenes - hjfd@academico.ufpb.br).");
    }

    if (user.senha && user.senha !== senha) {
      throw new Error("Senha incorreta. Tente novamente.");
    }

    if (user.status === "inativo") {
      throw new Error("Seu acesso está inativo no momento. Procure o Gestor Principal ou a PRG.");
    }

    this.currentUser = {
      id: user.id,
      nome: user.nome,
      email: user.email,
      setor: user.setor,
      perfil: user.perfil,
      isMasterAdmin: isMaster || !!user.isMasterAdmin,
      cargo: user.cargo || (isMaster ? "Gestor Principal da Agenda SisInfra" : (user.perfil === "admin" ? "Gestor SisInfra" : "Operador")),
      status: user.status
    };

    sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
    return this.currentUser;
  }

  async logout() {
    if (window.isFirebaseActive && window.fbAuth) {
      try {
        await window.fbAuth.signOut();
      } catch (e) {
        console.error("Erro ao sair do Firebase:", e);
      }
    }
    this.currentUser = null;
    sessionStorage.removeItem("prg_current_user");
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: null }));
  }

  // Atalho para teste rápido em demonstração
  async quickLogin(role = "admin") {
    if (role === "admin" || role === "master" || role === "hjfd") {
      return await this.login("hjfd@academico.ufpb.br", "admin123");
    } else {
      return await this.login("operador@academico.ufpb.br", "operador123");
    }
  }

  translateFirebaseError(code) {
    switch (code) {
      case "auth/user-not-found":
        return "Nenhum usuário cadastrado com este e-mail.";
      case "auth/wrong-password":
        return "Senha incorreta.";
      case "auth/invalid-email":
        return "Formato de e-mail inválido.";
      case "auth/user-disabled":
        return "Este usuário foi desativado.";
      case "auth/popup-closed-by-user":
        return "A janela de login com Google foi fechada antes de concluir.";
      default:
        return null;
    }
  }
}

window.authService = new AuthService();
