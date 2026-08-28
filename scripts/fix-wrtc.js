// scripts/fix-wrtc.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('🔧 Corrigindo instalação do wrtc...');

try {
  const platform = os.platform();
  
  // Verifica se o wrtc está instalado
  const wrtcPath = path.join(__dirname, '..', 'node_modules', 'wrtc');
  
  if (!fs.existsSync(wrtcPath)) {
    console.log('📦 wrtc não encontrado, instalando...');
    execSync('npm install wrtc@0.4.7 --legacy-peer-deps', { stdio: 'inherit' });
  }
  
  console.log(`📦 Recompilando wrtc para ${platform}...`);
  
  // Tenta recompilar usando diferentes métodos
  try {
    // Método 1: electron-rebuild
    execSync('npm run rebuild', { stdio: 'inherit' });
  } catch (error) {
    console.log('⚠️ Método 1 falhou, tentando método 2...');
    try {
      // Método 2: node-gyp diretamente
      const nodeGypPath = path.join(__dirname, '..', 'node_modules', '.bin', 'node-gyp');
      const wrtcBuildPath = path.join(__dirname, '..', 'node_modules', 'wrtc');
      
      if (fs.existsSync(nodeGypPath)) {
        execSync(`cd ${wrtcBuildPath} && ${nodeGypPath} rebuild`, { stdio: 'inherit' });
      } else {
        // Método 3: npm rebuild
        execSync('npm rebuild wrtc --update-binary', { stdio: 'inherit' });
      }
    } catch (error2) {
      console.log('⚠️ Método 2 falhou, tentando método 3...');
      // Método 3: Instalação limpa
      execSync('npm uninstall wrtc && npm install wrtc@0.4.7 --legacy-peer-deps', { stdio: 'inherit' });
    }
  }
  
  console.log('✅ Correção concluída com sucesso!');
} catch (error) {
  console.error('❌ Erro ao corrigir wrtc:', error.message);
  process.exit(1);
}