// scripts/install-native.js
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔧 Instalando módulo nativo de áudio...');

const platform = os.platform();
const nativeDir = path.join(__dirname, '..', 'native');
const buildDir = path.join(nativeDir, 'build');

try {
  // Verifica se já está compilado
  if (fs.existsSync(path.join(buildDir, 'Release', 'audio_capture.node'))) {
    console.log('✅ Módulo nativo já está compilado');
    process.exit(0);
  }

  console.log(`📦 Compilando para ${platform}...`);
  
  // Compila o módulo nativo
  execSync('npm run build:native', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
  });
  
  console.log('✅ Módulo nativo compilado com sucesso!');
} catch (error) {
  console.error('❌ Erro ao compilar módulo nativo:', error.message);
  console.log('⚠️ Continuando sem suporte a áudio nativo');
}