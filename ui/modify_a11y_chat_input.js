import fs from 'fs';

const path = './src/components/ChatInput.tsx';
let txt = fs.readFileSync(path, 'utf8');

if (!txt.includes('autoFocus')) {
  txt = txt.replace(
    /<textarea\n\s*ref=\{textareaRef\}/,
    "<textarea\n        autoFocus\n        ref={textareaRef}"
  );
  fs.writeFileSync(path, txt);
}
