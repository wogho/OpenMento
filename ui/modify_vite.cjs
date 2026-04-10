const fs = require('fs');
let content = fs.readFileSync('/workspaces/codespaces-blank/educlip/ui/vite.config.ts', 'utf8');
content = content.replace(/\s*test:\s*\{[\s\S]*?\}\]\n\s*\}/g, '');
fs.writeFileSync('/workspaces/codespaces-blank/educlip/ui/vite.config.ts', content);
