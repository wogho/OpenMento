const fs = require('fs');
const path = './src/components/TypingIndicator.tsx';
let txt = fs.readFileSync(path, 'utf8');

txt = txt.replace(
  "export default function TypingIndicator() {",
  "import Lottie from 'lottie-react';\nimport thinkingAnimation from '../assets/lottie/thinking.json';\n\nexport default function TypingIndicator() {"
);

txt = txt.replace(
  /{key={i}[^>]+>\s*<\/span>\n\s*\)\)}/g,
  "{<Lottie animationData={thinkingAnimation} loop={true} autoplay={true} style={{ width: 24, height: 24 }} />}"
);
txt = txt.replace(
  /\{\[0, 1, 2\]\.map\(\(i\) => \(\s*<span/,
  "<Lottie animationData={thinkingAnimation} loop={true} autoplay={true} style={{ width: 24, height: 24 }} />\n          {/*"
);
txt = txt.replace(
  /style=\{\{ animationDelay: `\$\{i \* 0\.16\}s` \}\}\s*\/>\n\s*\)\)}/,
  "*/}"
);

fs.writeFileSync(path, txt);
