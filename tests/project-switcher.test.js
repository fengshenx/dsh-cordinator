import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  basenameOf,
  groupSessionsByProject,
  pickProjectSession,
  projectPathOf,
} from '../src/client/project-switcher.js'

test('basenameOf 取路径末段，两种分隔符都认', () => {
  assert.equal(basenameOf('/work/alpha'), 'alpha')
  assert.equal(basenameOf('C:\\work\\alpha'), 'alpha')
  assert.equal(basenameOf('/work/alpha/'), 'alpha')
  assert.equal(basenameOf('alpha'), 'alpha')
})

test('按工作目录聚成项目，同目录的会话归到一起', () => {
  const projects = groupSessionsByProject([
    { id: 's1', cwd: '/work/alpha', displayTitle: '甲', updatedAt: 100 },
    { id: 's2', cwd: '/work/alpha', displayTitle: '乙', updatedAt: 200 },
    { id: 's3', cwd: '/work/beta', displayTitle: '丙', updatedAt: 300 },
  ])
  assert.equal(projects.length, 2)
  assert.equal(projects[0].path, '/work/alpha')
  assert.equal(projects[0].sessions.length, 2)
})

test('子会话不单列为项目', () => {
  const projects = groupSessionsByProject([
    { id: 's1', cwd: '/work/alpha', updatedAt: 100 },
    { id: 'child', cwd: '/work/alpha', origin: 'subagent', updatedAt: 200 },
  ])
  assert.equal(projects.length, 1)
  assert.equal(projects[0].sessions.length, 1)
})

test('没有工作目录的会话不构成项目', () => {
  const projects = groupSessionsByProject([
    { id: 's1', cwd: '', updatedAt: 100 },
    { id: 's2', updatedAt: 200 },
  ])
  assert.equal(projects.length, 0)
})

test('项目内会话按更新时间倒序，切换目标取最近更新的', () => {
  const projects = groupSessionsByProject([
    { id: 'old', cwd: '/work/alpha', updatedAt: 100 },
    { id: 'new', cwd: '/work/alpha', updatedAt: 200 },
  ])
  assert.equal(pickProjectSession(projects[0].sessions).id, 'new')
})

test('取会话所属项目目录', () => {
  const rows = [
    { id: 's1', cwd: '/work/alpha', updatedAt: 100 },
    { id: 's2', cwd: '/work/beta', updatedAt: 200 },
  ]
  assert.equal(projectPathOf(rows, 's2'), '/work/beta')
  assert.equal(projectPathOf(rows, 'missing'), undefined)
})
