import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ftranslate.mobile',
  appName: 'FTranslate Mobile',
  webDir: 'dist-mobile',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f7f9fc'
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
