// scripts/fix-wrtc.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('🔧 Verificando instalação do wrtc...');

try {
  const platform = os.platform();
  
  // Verifica se o wrtc está instalado
  const wrtcPath = path.join(__dirname, '..', 'node_modules', 'wrtc');
  
  if (!fs.existsSync(wrtcPath)) {
    console.log('📦 wrtc não encontrado, instalando...');
    execSync('npm install wrtc@0.4.7 --legacy-peer-deps', { stdio: 'inherit' });
  } else {
    console.log('✅ wrtc já está instalado');
  }
  
  console.log(`📦 Verificando compatibilidade para ${platform}...`);
  
  // Tenta recompilar usando electron-rebuild
  try {
    execSync('npm run rebuild', { stdio: 'inherit' });
    console.log('✅ Recompilação concluída com sucesso!');
  } catch (error) {
    console.log('⚠️ Recompilação via electron-rebuild falhou, tentando alternativa...');
    try {
      execSync('npm rebuild wrtc --update-binary', { stdio: 'inherit' });
      console.log('✅ Reconstrução concluída com sucesso!');
    } catch (error2) {
      console.log('⚠️ Aviso: Não foi possível recompilar wrtc, mas pode funcionar mesmo assim.');
    }
  }
  
  console.log('✅ Setup concluído!');
} catch (error) {
  console.error('❌ Erro no setup:', error.message);
  // Não falha o build, apenas avisa
  console.log('⚠️ Continuando mesmo com erro...');
}
