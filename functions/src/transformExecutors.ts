import type { ApiExecutor } from './apiRegistry.js';

/**
 * Transform executors — no-LLM data processing nodes.
 * These slot into API_EXECUTORS and run through the existing API short-circuit path.
 */
export const TRANSFORM_EXECUTORS: Record<string, ApiExecutor> = {
  transform_regex: {
    execute: async (params) => {
      const text = params.text ?? '';
      const pattern = params.pattern ?? '';
      const flags = params.flags ?? 'g';
      const group = parseInt(params.group ?? '0', 10) || 0;
      if (!pattern) return 'No regex pattern provided.';
      try {
        const regex = new RegExp(pattern, flags);
        const matches: string[] = [];
        let match: RegExpExecArray | null;
        if (flags.includes('g')) {
          while ((match = regex.exec(text)) !== null) {
            matches.push(match[group] ?? match[0]);
            if (!regex.global) break;
          }
        } else {
          match = regex.exec(text);
          if (match) matches.push(match[group] ?? match[0]);
        }
        if (matches.length === 0) return 'No matches found.';
        return matches.join('\n');
      } catch (e) {
        return `Invalid regex: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },

  transform_json_path: {
    execute: async (params) => {
      const text = params.text ?? '';
      const path = params.path ?? '';
      if (!path) return 'No JSON path provided.';
      try {
        let data = JSON.parse(text);
        const parts = path.split('.').filter(Boolean);
        for (const part of parts) {
          // Support array indexing: items[0]
          const bracketMatch = part.match(/^(\w+)\[(\d+)\]$/);
          if (bracketMatch) {
            data = data?.[bracketMatch[1]];
            data = data?.[parseInt(bracketMatch[2], 10)];
          } else {
            data = data?.[part];
          }
          if (data === undefined) return `Path not found: ${path}`;
        }
        return typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
      } catch (e) {
        return `JSON parse error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },

  transform_math: {
    execute: async (params) => {
      const expression = params.expression ?? '';
      if (!expression) return 'No expression provided.';
      // Sanitize: only allow digits, operators, parentheses, decimal points, spaces, and Math functions
      const sanitized = expression.trim();
      if (!/^[\d\s+\-*/().,%^a-zA-Z]+$/.test(sanitized)) {
        return 'Invalid characters in expression.';
      }
      // Disallow anything that could be code injection
      const dangerous = /(\b(eval|function|return|var|let|const|import|require|window|document|global|process)\b|[;{}[\]`$])/i;
      if (dangerous.test(sanitized)) {
        return 'Expression contains disallowed keywords.';
      }
      try {
        // Replace common math functions with Math. equivalents
        const mathExpr = sanitized
          .replace(/\bsqrt\b/g, 'Math.sqrt')
          .replace(/\babs\b/g, 'Math.abs')
          .replace(/\bround\b/g, 'Math.round')
          .replace(/\bfloor\b/g, 'Math.floor')
          .replace(/\bceil\b/g, 'Math.ceil')
          .replace(/\bmin\b/g, 'Math.min')
          .replace(/\bmax\b/g, 'Math.max')
          .replace(/\bpow\b/g, 'Math.pow')
          .replace(/\bPI\b/g, 'Math.PI')
          .replace(/\bE\b/g, 'Math.E')
          .replace(/\^/g, '**')
          .replace(/%/g, '/100*');
        // eslint-disable-next-line no-new-func
        const result = new Function(`"use strict"; return (${mathExpr});`)();
        if (typeof result !== 'number' || !Number.isFinite(result)) {
          return `Result is not a finite number: ${result}`;
        }
        return String(result);
      } catch (e) {
        return `Math error: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  },

  transform_case: {
    execute: async (params) => {
      const text = params.text ?? '';
      const operation = (params.operation ?? 'upper').toLowerCase();
      switch (operation) {
        case 'upper':
          return text.toUpperCase();
        case 'lower':
          return text.toLowerCase();
        case 'title':
          return text.replace(/\b\w/g, (c) => c.toUpperCase());
        case 'snake':
          return text
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[\s\-]+/g, '_')
            .toLowerCase();
        case 'kebab':
          return text
            .replace(/([a-z])([A-Z])/g, '$1-$2')
            .replace(/[\s_]+/g, '-')
            .toLowerCase();
        default:
          return `Unknown case operation: ${operation}. Use: upper, lower, title, snake, kebab`;
      }
    },
  },

  transform_list: {
    execute: async (params) => {
      const text = params.text ?? '';
      const operation = (params.operation ?? 'sort').toLowerCase();
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length === 0) return 'Empty list.';
      switch (operation) {
        case 'sort':
          return [...lines].sort((a, b) => a.localeCompare(b)).join('\n');
        case 'reverse':
          return [...lines].reverse().join('\n');
        case 'unique':
          return [...new Set(lines)].join('\n');
        case 'count':
          return String(lines.length);
        case 'shuffle': {
          const shuffled = [...lines];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled.join('\n');
        }
        default:
          return `Unknown list operation: ${operation}. Use: sort, reverse, unique, count, shuffle`;
      }
    },
  },

  transform_split_join: {
    execute: async (params) => {
      const text = params.text ?? '';
      const operation = (params.operation ?? 'split').toLowerCase();
      const delimiter = params.delimiter ?? ',';
      switch (operation) {
        case 'split':
          return text.split(delimiter).map((s) => s.trim()).join('\n');
        case 'join':
          return text.split('\n').map((s) => s.trim()).filter(Boolean).join(delimiter);
        default:
          return `Unknown operation: ${operation}. Use: split, join`;
      }
    },
  },

  transform_template: {
    execute: async (params) => {
      const text = params.text ?? '';
      const template = params.template ?? '{0}';
      const lines = text.split('\n').map((l) => l.trim());
      // Replace {0}, {1}, etc. with corresponding input lines
      let result = template;
      for (let i = 0; i < lines.length; i++) {
        result = result.split(`{${i}}`).join(lines[i] ?? '');
      }
      return result;
    },
  },
};
