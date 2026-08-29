// electron/main.cjs
const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const { autoUpdater } = require('electron-updater');

// ============ CONFIGURAÇÃO DO AUTO-UPDATER ============
autoUpdater.logger = require('electron-log');
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Força a verificação mesmo em desenvolvimento (para testes)
autoUpdater.forceDevUpdateConfig = true;

// Eventos
autoUpdater.on('checking-for-update', () => {
  console.log('🔍 Verificando atualizações...');
  if (mainWindow) mainWindow.webContents.send('update-status', 'checking');
});

autoUpdater.on('update-available', (info) => {
  console.log('✅ Atualização disponível! Versão:', info.version);
  if (mainWindow) mainWindow.webContents.send('update-status', 'available', info);
});

autoUpdater.on('update-not-available', () => {
  console.log('ℹ️ App está atualizado.');
  if (mainWindow) mainWindow.webContents.send('update-status', 'not-available');
});

autoUpdater.on('download-progress', (progressObj) => {
  console.log(`📦 Download: ${Math.round(progressObj.percent)}%`);
  if (mainWindow) mainWindow.webContents.send('update-progress', progressObj);
});

autoUpdater.on('update-downloaded', () => {
  console.log('✅ Atualização baixada. Instalando...');
  if (mainWindow) mainWindow.webContents.send('update-downloaded');
  autoUpdater.quitAndInstall();
});

autoUpdater.on('error', (err) => {
  console.error('❌ Erro no auto-updater:', err);
  if (mainWindow) mainWindow.webContents.send('update-error', err.message);
});

// ============ RESTO DO CÓDIGO (mainWindow, ipc, etc.) ============
// ... (mantenha o resto do seu código aqui, incluindo createWindow, setupIpc, etc.)

app.whenReady().then(() => {
  createWindow();
  setupIpc();
  gameInterval = setInterval(detectGames, 15000);

  // 🔥 FORÇA A VERIFICAÇÃO DE ATUALIZAÇÃO EM PRODUÇÃO
  // Se NÃO estiver em desenvolvimento, executa
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'production') {
    console.log('🚀 Verificando atualizações...');
    autoUpdater.checkForUpdatesAndNotify();
  }
});

// ============ HANDLER PARA FORÇAR VERIFICAÇÃO MANUAL ============
ipcMain.handle('check-for-updates', async () => {
  try {
    console.log('🔍 Verificando atualizações manualmente...');
    const result = await autoUpdater.checkForUpdates();
    return { success: true, result };
  } catch (error) {
    console.error('❌ Erro ao verificar atualizações:', error);
    return { success: false, error: error.message };
  }
});
