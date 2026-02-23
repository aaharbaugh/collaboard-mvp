import { TRANSFORM_EXECUTORS } from './transformExecutors';

describe('TRANSFORM_EXECUTORS', () => {
  it('has all 7 transform executors', () => {
    const expected = [
      'transform_regex', 'transform_json_path', 'transform_math',
      'transform_case', 'transform_list', 'transform_split_join', 'transform_template',
    ];
    for (const id of expected) {
      expect(TRANSFORM_EXECUTORS[id]).toBeDefined();
      expect(typeof TRANSFORM_EXECUTORS[id].execute).toBe('function');
    }
  });

  describe('transform_regex', () => {
    const exec = TRANSFORM_EXECUTORS.transform_regex.execute!;

    it('extracts all matches with global flag', async () => {
      const result = await exec({ text: 'abc 123 def 456', pattern: '\\d+', flags: 'g', group: '0' });
      expect(result).toBe('123\n456');
    });

    it('returns error for invalid regex', async () => {
      const result = await exec({ text: 'test', pattern: '[invalid', flags: 'g', group: '0' });
      expect(result).toMatch(/Invalid regex/);
    });

    it('returns no matches message when nothing found', async () => {
      const result = await exec({ text: 'abc', pattern: '\\d+', flags: 'g', group: '0' });
      expect(result).toBe('No matches found.');
    });
  });

  describe('transform_json_path', () => {
    const exec = TRANSFORM_EXECUTORS.transform_json_path.execute!;

    it('traverses nested JSON', async () => {
      const json = JSON.stringify({ data: { name: 'test' } });
      const result = await exec({ text: json, path: 'data.name' });
      expect(result).toBe('test');
    });

    it('supports array indexing', async () => {
      const json = JSON.stringify({ items: ['a', 'b', 'c'] });
      const result = await exec({ text: json, path: 'items[1]' });
      expect(result).toBe('b');
    });

    it('returns error for invalid JSON', async () => {
      const result = await exec({ text: 'not json', path: 'data' });
      expect(result).toMatch(/JSON parse error/);
    });

    it('returns path not found for missing key', async () => {
      const result = await exec({ text: '{"a": 1}', path: 'b.c' });
      expect(result).toBe('Path not found: b.c');
    });
  });

  describe('transform_math', () => {
    const exec = TRANSFORM_EXECUTORS.transform_math.execute!;

    it('evaluates basic arithmetic', async () => {
      const result = await exec({ expression: '2 + 3 * 4' });
      expect(result).toBe('14');
    });

    it('supports Math functions via aliases', async () => {
      const result = await exec({ expression: 'sqrt(16)' });
      expect(result).toBe('4');
    });

    it('rejects dangerous expressions', async () => {
      const result = await exec({ expression: 'eval("alert(1)")' });
      expect(result).toMatch(/Invalid characters|disallowed/);
    });

    it('returns empty expression message', async () => {
      const result = await exec({ expression: '' });
      expect(result).toBe('No expression provided.');
    });
  });

  describe('transform_case', () => {
    const exec = TRANSFORM_EXECUTORS.transform_case.execute!;

    it('converts to upper case', async () => {
      expect(await exec({ text: 'hello', operation: 'upper' })).toBe('HELLO');
    });

    it('converts to lower case', async () => {
      expect(await exec({ text: 'HELLO', operation: 'lower' })).toBe('hello');
    });

    it('converts to title case', async () => {
      expect(await exec({ text: 'hello world', operation: 'title' })).toBe('Hello World');
    });

    it('converts to snake_case', async () => {
      expect(await exec({ text: 'helloWorld', operation: 'snake' })).toBe('hello_world');
    });

    it('converts to kebab-case', async () => {
      expect(await exec({ text: 'helloWorld', operation: 'kebab' })).toBe('hello-world');
    });
  });

  describe('transform_list', () => {
    const exec = TRANSFORM_EXECUTORS.transform_list.execute!;

    it('sorts lines alphabetically', async () => {
      expect(await exec({ text: 'banana\napple\ncherry', operation: 'sort' })).toBe('apple\nbanana\ncherry');
    });

    it('reverses lines', async () => {
      expect(await exec({ text: 'a\nb\nc', operation: 'reverse' })).toBe('c\nb\na');
    });

    it('removes duplicates', async () => {
      expect(await exec({ text: 'a\nb\na\nc\nb', operation: 'unique' })).toBe('a\nb\nc');
    });

    it('counts lines', async () => {
      expect(await exec({ text: 'a\nb\nc', operation: 'count' })).toBe('3');
    });

    it('shuffles lines (produces result with same items)', async () => {
      const result = await exec({ text: 'a\nb\nc', operation: 'shuffle' });
      const items = result.split('\n').sort();
      expect(items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('transform_split_join', () => {
    const exec = TRANSFORM_EXECUTORS.transform_split_join.execute!;

    it('splits by delimiter', async () => {
      expect(await exec({ text: 'a,b,c', operation: 'split', delimiter: ',' })).toBe('a\nb\nc');
    });

    it('joins lines with delimiter', async () => {
      expect(await exec({ text: 'a\nb\nc', operation: 'join', delimiter: ', ' })).toBe('a, b, c');
    });
  });

  describe('transform_template', () => {
    const exec = TRANSFORM_EXECUTORS.transform_template.execute!;

    it('replaces positional placeholders', async () => {
      const result = await exec({ text: 'Alice\nBob', template: 'Hello {0}, meet {1}!' });
      expect(result).toBe('Hello Alice, meet Bob!');
    });
  });
});
