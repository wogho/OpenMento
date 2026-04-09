/**
 * no-direct-db-in-routes.js
 *
 * ESLint 커스텀 룰 — Phase 5-2 ② 트랜잭션 이탈(Context Escape) 방지
 *
 * 목적:
 *   server/src/routes/ 파일에서 @educlip/db 의 `db` 객체를 직접 사용하는 것을
 *   금지합니다. 모든 DB 접근은 반드시:
 *     - withTenantContext()  (멀티 테넌트 격리 트랜잭션)
 *     - server/src/repositories/ 계층
 *   를 통해서만 이뤄져야 합니다.
 *
 * 탐지 패턴:
 *   1. `import { db } from '@educlip/db'` — routes 파일에서 db 직접 import
 *   2. `db.select(...)`, `db.insert(...)` 등 — db 객체 메서드 호출
 *      (withTenantContext 내부의 tx.* 는 허용)
 *
 * 허용 예외:
 *   - repositories/ 디렉토리 (Tenant Repository 계층 구현)
 *   - middleware/ 디렉토리 (인증·RBAC 미들웨어)
 *   - services/ 디렉토리 (비즈니스 로직 서비스)
 *   - __tests__/ (테스트 파일은 모킹을 위해 직접 import 허용)
 *
 * 사용법 (.eslintrc.json):
 *   "plugins": ["local-rules"],
 *   "rules": {
 *     "local-rules/no-direct-db-in-routes": "error"
 *   }
 */

'use strict';

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prevent direct `db` usage in route files. Use withTenantContext() or repositories instead.',
      category: 'Multi-Tenancy Security',
      recommended: true,
    },
    schema: [
      {
        type: 'object',
        properties: {
          // 추가로 금지할 심볼 이름 목록 (기본: ['db'])
          forbiddenSymbols: {
            type: 'array',
            items: { type: 'string' },
          },
          // 허용할 디렉토리 패턴 목록 (파일 경로에 포함 여부로 판단)
          allowedPathPatterns: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noDirectDbImport:
        "Route 파일에서 '{{ symbol }}'를 @educlip/db 에서 직접 import할 수 없습니다. " +
        'withTenantContext(tx => ...) 또는 repositories 계층을 사용하세요.',
      noDirectDbCall:
        "'{{ symbol }}.{{ method }}()' 를 route 파일에서 직접 호출할 수 없습니다. " +
        'withTenantContext(tx => tx.{{ method }}(...)) 형태로 래핑하세요.',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const forbiddenSymbols = options.forbiddenSymbols ?? ['db'];
    const allowedPathPatterns = options.allowedPathPatterns ?? [
      '/repositories/',
      '/middleware/',
      '/services/',
      '/__tests__/',
      '.test.',
      '.spec.',
    ];

    const filename = context.getFilename();

    // 허용된 경로이면 룰 비활성화
    const isAllowedPath = allowedPathPatterns.some((pattern) => filename.includes(pattern));
    if (isAllowedPath) {
      return {};
    }

    // routes/ 경로인지 확인 (route 파일에서만 검사)
    const isRoutesFile = filename.includes('/routes/');
    if (!isRoutesFile) {
      return {};
    }

    // 현재 파일에서 금지 심볼이 import됐는지 추적
    const importedForbiddenSymbols = new Set();

    return {
      // import { db } from '@educlip/db' 감지
      ImportDeclaration(node) {
        if (node.source.value !== '@educlip/db') return;

        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier') {
            const importedName = specifier.imported.name;
            const localName = specifier.local.name;

            if (forbiddenSymbols.includes(importedName)) {
              importedForbiddenSymbols.add(localName);
              context.report({
                node: specifier,
                messageId: 'noDirectDbImport',
                data: { symbol: importedName },
              });
            }
          }
        }
      },

      // db.select(...), db.insert(...) 등 직접 메서드 호출 감지
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          importedForbiddenSymbols.has(node.callee.object.name)
        ) {
          const symbolName = node.callee.object.name;
          const methodName = node.callee.property.name ?? node.callee.property.value;

          // withTenantContext 콜백(tx) 안에서의 호출은 허용 (상위 콜스택이 withTenantContext)
          let ancestor = node.parent;
          let insideTenantContext = false;
          while (ancestor) {
            if (
              ancestor.type === 'CallExpression' &&
              ancestor.callee.type === 'Identifier' &&
              ancestor.callee.name === 'withTenantContext'
            ) {
              insideTenantContext = true;
              break;
            }
            ancestor = ancestor.parent;
          }

          if (!insideTenantContext) {
            context.report({
              node,
              messageId: 'noDirectDbCall',
              data: { symbol: symbolName, method: methodName },
            });
          }
        }
      },
    };
  },
};
