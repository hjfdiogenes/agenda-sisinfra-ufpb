/**
 * SISTEMA DE AGENDAMENTO DE AUDITÓRIOS - CENTRAL DE AULAS (PRG / UFPB)
 * Configuração do Firebase & Detecção Automática
 * 
 * INSTRUÇÕES:
 * 1. Crie um projeto no console do Firebase: https://console.firebase.google.com/
 * 2. Em "Configurações do Projeto" > "Geral" > "Seus aplicativos", crie um app Web (</>).
 * 3. Copie as credenciais e substitua no objeto firebaseConfig abaixo.
 * 4. Ative os serviços no console:
 *    - "Authentication" (ative Provedor de E-mail/Senha)
 *    - "Cloud Firestore" (crie o banco de dados no modo de teste ou aplique firestore.rules)
 *    - "Hosting" (para publicar gratuitamente com 'firebase deploy')
 */

const firebaseConfig = {
  apiKey: "AIzaSyBE_g7gE6GW5ifP7jfYwjASfeUZAUrNd-8",
  authDomain: "agenda-sisinfra-ufpb.firebaseapp.com",
  projectId: "agenda-sisinfra-ufpb",
  storageBucket: "agenda-sisinfra-ufpb.firebasestorage.app",
  messagingSenderId: "97983625913",
  appId: "1:97983625913:web:d3c2b0516789ed50b7f968",
  measurementId: "G-QP58FKRVTG"
};

// Verifica se há configuração salva no localStorage pelo Gestor
try {
  const localSaved = localStorage.getItem("prg_firebase_config");
  if (localSaved) {
    const parsed = JSON.parse(localSaved);
    if (parsed.apiKey && parsed.projectId && parsed.apiKey !== "SUA_API_KEY_AQUI") {
      Object.assign(firebaseConfig, parsed);
    }
  }
} catch (e) {}

// Verifica se as credenciais reais foram preenchidas
function isFirebaseConfigured() {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "SUA_API_KEY_AQUI" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "seu-projeto-prg"
  );
}

// Instâncias globais
window.isFirebaseActive = false;
window.fbAuth = null;
window.fbDb = null;
window.firebaseConfig = firebaseConfig;

// Inicialização segura
try {
  if (isFirebaseConfigured() && typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    window.fbAuth = firebase.auth();
    window.fbDb = firebase.firestore();
    window.isFirebaseActive = true;
    console.log("✅ Conectado com sucesso ao Firebase!");
  } else {
    console.info("ℹ️ Firebase não configurado. Rodando em Modo Demonstração com LocalStorage.");
    window.isFirebaseActive = false;
  }
} catch (error) {
  console.warn("⚠️ Erro ao inicializar Firebase. Alternando para Modo Demonstração:", error);
  window.isFirebaseActive = false;
}
