import fs from 'fs';
const path = './src/pages/PortfolioPage.tsx';
let txt = fs.readFileSync(path, 'utf8');

// 1. Add imports
txt = txt.replace(
  "import OriginalityGauge, { type SimilarityVerdict } from '../components/portfolio/OriginalityGauge';",
  "import OriginalityGauge, { type SimilarityVerdict } from '../components/portfolio/OriginalityGauge';\nimport { motion, AnimatePresence } from 'framer-motion';\nimport { toast } from 'sonner';"
);

// 2. Wrap the phase conditions in AnimatePresence
// In render:
txt = txt.replace(
  "{/* ── 시작 화면 ── */}",
  "<AnimatePresence mode=\"wait\">\n          {/* ── 시작 화면 ── */}"
);

// Close AnimatePresence right before `</div>\n      </main>`
txt = txt.replace(
  "        </div>\n      </main>\n    </div>\n  );\n}",
  "          </AnimatePresence>\n        </div>\n      </main>\n    </div>\n  );\n}"
);

// 3. Change <section ... > to <motion.section key="..." initial="..." animate="..." exit="..." transition="..." ...>
txt = txt.replace(
  "{phase === 'start' && (\n            <section className=\"bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5\">",
  `{phase === 'start' && (\n            <motion.section \n              key="start"\n              initial={{ opacity: 0, y: 20 }}\n              animate={{ opacity: 1, y: 0 }}\n              exit={{ opacity: 0, y: -20 }}\n              transition={{ duration: 0.3 }}\n              className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-5">`
);

txt = txt.replace(
  "{phase === 'interview' && workflow && (\n            <section id=\"portfolio-interview-chat\" className=\"space-y-3\">",
  `{phase === 'interview' && workflow && (\n            <motion.section \n              key="interview"\n              initial={{ opacity: 0, x: -20 }}\n              animate={{ opacity: 1, x: 0 }}\n              exit={{ opacity: 0, x: 20 }}\n              transition={{ duration: 0.3 }}\n              id="portfolio-interview-chat" className="space-y-3">`
);

txt = txt.replace(
  "{phase === 'proposal' && (\n            <section className=\"bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4\">",
  `{phase === 'proposal' && (\n            <motion.section \n              key="proposal"\n              initial={{ opacity: 0, y: 20 }}\n              animate={{ opacity: 1, y: 0 }}\n              exit={{ opacity: 0, y: -20 }}\n              transition={{ duration: 0.4 }}\n              className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">`
);

txt = txt.replace(
  "{phase === 'report' && (\n            <section className=\"bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6\">",
  `{phase === 'report' && (\n            <motion.section \n              key="report"\n              initial={{ opacity: 0, scale: 0.95 }}\n              animate={{ opacity: 1, scale: 1 }}\n              exit={{ opacity: 0, scale: 0.95 }}\n              transition={{ duration: 0.5 }}\n              className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">`
);

// 4. Change closing tags
txt = txt.replace(
  /<\/section>\n          \)}/g,
  "</motion.section>\n          )}"
);

fs.writeFileSync(path, txt);
