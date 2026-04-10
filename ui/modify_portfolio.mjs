const fs = require('fs');
const path = './ui/src/pages/PortfolioPage.tsx';
let txt = fs.readFileSync(path, 'utf8');

txt = txt.replace(
  "import OriginalityGauge, { type SimilarityVerdict } from '../components/portfolio/OriginalityGauge';",
  "import OriginalityGauge, { type SimilarityVerdict } from '../components/portfolio/OriginalityGauge';\nimport { motion, AnimatePresence } from 'framer-motion';\nimport { toast } from 'sonner';"
);

// We want to wrap the conditional renders for Start, Interview, Proposal, Report in <AnimatePresence mode="wait"> and <motion.div>
// Let's just create a wrapper function or find the sections.
// Easiest is to replace:
/*
          {phase === 'start' && (
            <section
*/
// with:
/*
          <AnimatePresence mode="wait">
            {phase === 'start' && (
              <motion.section
                key="start"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="..."
              ...
*/

// For Phase 7-2 Micro-interactions
txt = txt.replace(/\{phase === 'start' && \(/g, "<AnimatePresence mode=\"wait\">\n          {phase === 'start' && (\n            <motion.div\n              key=\"start\"\n              initial={{ opacity: 0, x: -20 }}\n              animate={{ opacity: 1, x: 0 }}\n              exit={{ opacity: 0, x: 20 }}\n              transition={{ duration: 0.3 }}\n            >");
txt = txt.replace(/\{\/\* ── 인터뷰 단계 ── \*\/\}\n          \{phase === 'interview' && workflow && \(/g, "{/* ── 인터뷰 단계 ── */}\n          {phase === 'interview' && workflow && (\n            <motion.div\n              key=\"interview\"\n              initial={{ opacity: 0, x: -20 }}\n              animate={{ opacity: 1, x: 0 }}\n              exit={{ opacity: 0, x: 20 }}\n              transition={{ duration: 0.3 }}\n            >");
txt = txt.replace(/\{\/\* ── 기획서 작성 단계 ── \*\/\}\n          \{phase === 'proposal' && \(/g, "{/* ── 기획서 작성 단계 ── */}\n          {phase === 'proposal' && (\n            <motion.div\n              key=\"proposal\"\n              initial={{ opacity: 0, y: 20 }}\n              animate={{ opacity: 1, y: 0 }}\n              exit={{ opacity: 0, y: -20 }}\n              transition={{ duration: 0.4 }}\n            >");
txt = txt.replace(/\{\/\* ── 결과 리포트 단계 ── \*\/\}\n          \{phase === 'report' && \(/g, "{/* ── 결과 리포트 단계 ── */}\n          {phase === 'report' && (\n            <motion.div\n              key=\"report\"\n              initial={{ opacity: 0, scale: 0.95 }}\n              animate={{ opacity: 1, scale: 1 }}\n              exit={{ opacity: 0, scale: 0.95 }}\n              transition={{ duration: 0.5 }}\n            >");

// Now close the motion.divs
// Find the sections closing tags.
// Start closes before {/* ── 인터뷰 단계 ── */}
txt = txt.replace(/<\/section>\n          \n          \{\/\* ── 인터뷰 단계 ── \*\/\}/g, "</section>\n            </motion.div>\n          )}\n\n          {/* ── 인터뷰 단계 ── */}");
// Wait, the replaced string had the condition so the closing `)}` is already there. Let's fix the ending of the motion div.
// Original: `)}`
// New: `</motion.div>\n          )}`
// I made a mistake in the regex replacements because I didn't match the closing `)}`.
