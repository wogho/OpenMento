import fs from 'fs';

// 1. Modify ChatPage.tsx for error banner a11y
const chatPath = './src/pages/ChatPage.tsx';
let chatTxt = fs.readFileSync(chatPath, 'utf8');

chatTxt = chatTxt.replace(
  /<div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600">/,
  "<div role=\"alert\" aria-live=\"assertive\" className=\"bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-600\">"
);
fs.writeFileSync(chatPath, chatTxt);

// 2. Modify TypingIndicator for a11y
const typingPath = './src/components/TypingIndicator.tsx';
let typingTxt = fs.readFileSync(typingPath, 'utf8');

typingTxt = typingTxt.replace(
  /<div className="bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 flex items-center gap-1">/,
  "<div role=\"status\" aria-live=\"polite\" className=\"bg-white border border-gray-100 rounded-2xl rounded-bl-sm shadow-sm px-4 py-3 flex items-center gap-1\">"
);
fs.writeFileSync(typingPath, typingTxt);

// 3. Modify ChatBubble for a11y (aria-live polite during streaming)
const bubblePath = './src/components/ChatBubble.tsx';
if (fs.existsSync(bubblePath)) {
  let bubbleTxt = fs.readFileSync(bubblePath, 'utf8');
  if (bubbleTxt.includes('isStreaming')) {
    bubbleTxt = bubbleTxt.replace(
      /className={`\$\{baseCls\} \$\{bgCls\}\`}/,
      "className={`${baseCls} ${bgCls}`} aria-live={isStreaming ? 'polite' : 'off'}"
    );
    fs.writeFileSync(bubblePath, bubbleTxt);
  }
}
