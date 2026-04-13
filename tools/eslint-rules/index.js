'use strict';

/**
 * eslint-plugin-local-rules/index.js
 *
 * 프로젝트 로컬 ESLint 플러그인 엔트리포인트.
 * .eslintrc.json 에서 "plugins": ["local-rules"] 로 로드합니다.
 */

module.exports = {
  rules: {
    'no-direct-db-in-routes': require('./no-direct-db-in-routes'),
  },
};
