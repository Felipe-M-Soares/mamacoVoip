import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mamacosvoip.app',
  appName: 'Mamacos Voip',
  webDir: 'dist',
  plugins: {
    SystemBars: {
      style: 'DARK',
      initialViewportFitValueHint: 'contain',
    },
  },
};

export default config;
