import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'TAMU Registration+',
  version: '1.0.0',
  description: 'GPA, grade distribution, and RMP ratings inside Schedule Builder',
  permissions: ['storage', 'tabs', 'scripting'],
  host_permissions: [
    '*://tamu.collegescheduler.com/*',
    '*://grades.adibarra.com/*',
    '*://www.ratemyprofessors.com/*',
    '*://howdyportal.tamu.edu/*',
  ],
  content_scripts: [
    {
      matches: ['*://tamu.collegescheduler.com/*'],
      js: ['src/content/interceptor.ts'],
      run_at: 'document_idle',
      world: 'MAIN',
    },
    {
      matches: ['*://tamu.collegescheduler.com/*'],
      js: ['src/content/index.ts'],
      css: ['src/content/styles/content.css'],
      run_at: 'document_idle',
    },
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_title: 'TAMU Registration+',
    default_popup: 'src/popup/index.html',
  },
  icons: {
    '16': 'src/assets/icons/icon16.png',
    '48': 'src/assets/icons/icon48.png',
    '128': 'src/assets/icons/icon128.png',
  },
});
