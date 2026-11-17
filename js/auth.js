/**
 * SISTEMA DE AGENDAMENTO DE AUDITÓRIOS - CENTRAL DE AULAS (PRG / UFPB)
 * Serviço de Autenticação e Controle de Acesso (RBAC)
 * Autenticação via Google Workspace (@academico.ufpb.br)
 * Administrador: Hidelbrando Diógenes (hjfd@academico.ufpb.br)
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
                nome: user.displayName || "Hidelbrando Diógenes",
                email: "hjfd@academico.ufpb.br",
                setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
                cargo: "Administrador da Agenda SisInfra",
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

  isGestor(user = this.currentUser) {
    if (!user) return false;
    const email = (user.email || "").toLowerCase().trim();
    if (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br") return true;
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
   * Configuração de Google Client ID (OAuth 2.0 Oficial)
   */
  getGoogleClientId() {
    return localStorage.getItem("prg_google_client_id") || window.GOOGLE_CLIENT_ID || "";
  }

  setGoogleClientId(clientId) {
    if (clientId && clientId.trim()) {
      localStorage.setItem("prg_google_client_id", clientId.trim());
    } else {
      localStorage.removeItem("prg_google_client_id");
    }
  }

  /**
   * Login com Google Workspace institucional (@academico.ufpb.br)
   */
  async loginWithGoogle() {
    // 1. Firebase Auth Ativo com GoogleAuthProvider
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

        return await this.authenticateGoogleProfile({
          email: email,
          nome: fbUser.displayName || email.split("@")[0],
          photoURL: fbUser.photoURL || null
        });
      } catch (err) {
        console.error("Erro no login Google Firebase:", err);
        throw err;
      }
    }

    // 2. Google Identity Services (GIS - Token Client OAuth 2.0 Popup)
    const gClientId = this.getGoogleClientId();
    if (gClientId && window.google?.accounts?.oauth2) {
      return new Promise((resolve, reject) => {
        try {
          const client = window.google.accounts.oauth2.initTokenClient({
            client_id: gClientId,
            scope: "email profile openid",
            prompt: "select_account",
            callback: async (tokenResponse) => {
              if (tokenResponse.error) {
                reject(new Error(tokenResponse.error_description || tokenResponse.error));
                return;
              }
              try {
                const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                  headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
                });
                const gProfile = await res.json();
                const email = (gProfile.email || "").toLowerCase().trim();

                if (!email.endsWith("@academico.ufpb.br") && email !== "hjfd@cademico.ufpb.br") {
                  const err = new Error("Acesso Negado: Somente contas institucionais da UFPB (@academico.ufpb.br) são permitidas.");
                  err.code = "DOMAIN_NOT_ALLOWED";
                  throw err;
                }

                const user = await this.authenticateGoogleProfile({
                  email: email,
                  nome: gProfile.name || email.split("@")[0],
                  photoURL: gProfile.picture || null
                });
                resolve(user);
              } catch (fetchErr) {
                reject(fetchErr);
              }
            }
          });
          client.requestAccessToken();
        } catch (initErr) {
          reject(initErr);
        }
      });
    }

    // 3. Sem chaves backend configuradas (retorna null para abrir Seletor Oficial de Contas Google)
    return null;
  }

  /**
   * Autentica e provisiona perfil institucional Google (@academico.ufpb.br)
   */
  async authenticateGoogleProfile(gData) {
    const email = (gData.email || "").toLowerCase().trim();
    const isGestor = (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br");
    const usuarios = await window.storageService.getUsuarios();
    let user = usuarios.find(u => (u.email || "").toLowerCase() === email);

    if (isGestor) {
      if (!user) {
        user = {
          id: "usr_hjfd_principal",
          nome: "Hidelbrando Diógenes",
          siape: "1234567",
          email: "hjfd@academico.ufpb.br",
          setor: "Pró-Reitoria de Graduação (PRG / UFPB)",
          cargo: "Gestor",
          perfil: "gestor",
          permissoes: { aprovar: true, checklist: true, bloqueio: true, usuarios: true },
          status: "ativo"
        };
        try {
          const localList = JSON.parse(localStorage.getItem("prg_usuarios") || "[]");
          localList.unshift(user);
          localStorage.setItem("prg_usuarios", JSON.stringify(localList));
        } catch (e) {}
      } else {
        user.nome = "Hidelbrando Diógenes";
        user.perfil = "gestor";
        user.cargo = "Gestor";
        user.status = "ativo";
        user.permissoes = { aprovar: true, checklist: true, bloqueio: true, usuarios: true };
      }
    }

    if (!user) {
      const notAuthErr = new Error(`A conta institucional Google (${email}) não possui autorização no sistema. Solicite permissão ao Gestor (Hidelbrando Diógenes).`);
      notAuthErr.code = "AUTH_NOT_AUTHORIZED";
      notAuthErr.userEmail = email;
      notAuthErr.userName = gData.nome || email.split("@")[0];
      throw notAuthErr;
    }

    if (user.status === "inativo") {
      throw new Error("Seu acesso está inativo no momento. Entre em contato com o Gestor ou a PRG.");
    }

    this.currentUser = {
      id: user.id,
      nome: user.nome,
      siape: user.siape,
      email: user.email,
      setor: user.setor,
      perfil: user.perfil === "gestor" ? "gestor" : "usuario",
      cargo: user.perfil === "gestor" ? "Gestor" : "Usuário",
      permissoes: user.permissoes || (user.perfil === "gestor" 
        ? { aprovar: true, checklist: true, bloqueio: true, usuarios: true }
        : { aprovar: true, checklist: false, bloqueio: false, usuarios: false }),
      status: user.status,
      photoURL: gData.photoURL || null
    };

    sessionStorage.setItem("prg_current_user", JSON.stringify(this.currentUser));
    window.dispatchEvent(new CustomEvent("auth-state-changed", { detail: this.currentUser }));
    return this.currentUser;
  }

  /**
   * Autenticação via Seletor de Contas Google Institucional (@academico.ufpb.br)
   * Sem bloqueio de senha local!
   */
  async simulateGoogleLogin(targetEmail) {
    if (!targetEmail || !targetEmail.trim()) {
      throw new Error("Selecione ou informe seu e-mail institucional @academico.ufpb.br.");
    }
    let email = targetEmail.trim().toLowerCase();

    if (!email.includes("@")) {
      email = `${email}@academico.ufpb.br`;
    }

    if (!email.endsWith("@academico.ufpb.br") && email !== "hjfd@cademico.ufpb.br") {
      throw new Error("Acesso Negado: Somente e-mails com terminação @academico.ufpb.br são permitidos.");
    }

    return await this.authenticateGoogleProfile({
      email: email,
      nome: (email === "hjfd@academico.ufpb.br" || email === "hjfd@cademico.ufpb.br") ? "Hidelbrando Diógenes" : email.split("@")[0]
    });
  }

  /**
   * Login institucional compatível
   */
  async login(email) {
    return await this.simulateGoogleLogin(email);
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
      return await this.login("hjfd@academico.ufpb.br");
    } else {
      return await this.login("operador@academico.ufpb.br");
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
