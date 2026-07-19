// admin-ui/tests/router.test.js
// Pure-function tests for the pattern-compile helper in src/router.js. router.js only touches
// window/document inside function bodies that these tests never call (compile() is pure), so
// importing it here under `bun test` (no DOM) is safe — same pattern as tests/auth.test.js.
import { test, expect } from 'bun:test'
import { compile } from '../src/router.js'

test('compile: :id segment matches and extracts as a capture group', () => {
  const { regex, paramNames } = compile('#/tenant/:id')
  expect(paramNames).toEqual(['id'])
  const match = '/tenant/42'.match(regex)
  expect(match).not.toBeNull()
  expect(match[1]).toBe('42')
})

test('compile: multiple :params extract in declared order', () => {
  const { regex, paramNames } = compile('#/tenant/:tenantId/user/:userId')
  expect(paramNames).toEqual(['tenantId', 'userId'])
  const match = '/tenant/7/user/9'.match(regex)
  expect(match[1]).toBe('7')
  expect(match[2]).toBe('9')
})

test('compile: literal segments escape regex special characters', () => {
  // "a.b+c" is a literal path segment, not a regex — "." must not match any char and
  // "+" must not mean "one or more of the previous char".
  const { regex } = compile('#/a.b+c/:id')
  expect('/axbxc/1'.match(regex)).toBeNull()
  expect('/a.b+c/1'.match(regex)).not.toBeNull()
})

test('compile: non-matching path returns null', () => {
  const { regex } = compile('#/customers')
  expect('/packages'.match(regex)).toBeNull()
  expect('/customers/extra'.match(regex)).toBeNull()
  expect('/customer'.match(regex)).toBeNull()
})
