import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import {
  COORDINATOR_PACKAGE, deriveProfilePackage, planNodeModules, resolveDevPaths,
} from '../scripts/dev-plan.mjs'

const WORKTREE = '/work/repo/.worktrees/feature-a'
const SOURCE_HOME = '/home/user/.dsh'

/** 造一份源 profile 的 package.json。 */
function sourcePackage() {
  return {
    name: 'dsh-profile-web',
    private: true,
    dependencies: {
      '@deepseek-ai/dsh-experimental-agent-team-profile': '0.2.1-rc.2',
      'dsh-remind': 'link:/home/user/code/dsh-remind',
      'dsh-coordinator': 'link:/home/user/code/dsh-coordinator',
    },
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remind', 'dsh-coordinator'],
      },
    },
  }
}

test('默认数据根落在工作树内，源 HOME 取 ~/.dsh', () => {
  const paths = resolveDevPaths({ worktree: WORKTREE, homeDir: '/home/user', env: {} })
  assert.equal(paths.home, join(WORKTREE, '.dev', 'home'))
  assert.equal(paths.sourceProfileDir, join(SOURCE_HOME, 'profiles', 'web'))
  assert.equal(paths.sourceNodeModules, join(SOURCE_HOME, 'profiles', 'web', 'node_modules'))
  assert.equal(paths.profileDir, join(WORKTREE, '.dev', 'home', 'profiles', 'web'))
})

test('DSH_HOME 与 DSH_HOME_SOURCE 都能覆盖', () => {
  const paths = resolveDevPaths({
    worktree: WORKTREE,
    homeDir: '/home/user',
    env: { DSH_HOME: '/tmp/dev-home', DSH_HOME_SOURCE: '/tmp/origin-home' },
  })
  assert.equal(paths.home, '/tmp/dev-home')
  assert.equal(paths.profileDir, '/tmp/dev-home/profiles/web')
  assert.equal(paths.sourceHome, '/tmp/origin-home')
})

test('派生 package.json 把插件依赖换成工作树链接，其余依赖照抄', () => {
  const derived = deriveProfilePackage(sourcePackage(), WORKTREE)
  assert.equal(derived.dependencies[COORDINATOR_PACKAGE], `link:${WORKTREE}`)
  assert.equal(derived.dependencies['dsh-remind'], 'link:/home/user/code/dsh-remind')
  assert.equal(derived.dependencies['@deepseek-ai/dsh-experimental-agent-team-profile'], '0.2.1-rc.2')
})

test('派生 package.json 不改入参', () => {
  const source = sourcePackage()
  deriveProfilePackage(source, WORKTREE)
  assert.equal(source.dependencies[COORDINATOR_PACKAGE], 'link:/home/user/code/dsh-coordinator')
  assert.deepEqual(source.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remind', 'dsh-coordinator',
  ])
})

test('源 profile 没装本插件时，bundle 列表补上它', () => {
  const source = sourcePackage()
  source.dependencies = { 'dsh-remind': 'link:/home/user/code/dsh-remind' }
  source.dsh.profile.bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remind']
  const derived = deriveProfilePackage(source, WORKTREE)
  assert.deepEqual(derived.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-remind', COORDINATOR_PACKAGE,
  ])
  assert.equal(derived.dependencies[COORDINATOR_PACKAGE], `link:${WORKTREE}`)
})

test('bundle 列表已有本插件时不重复追加', () => {
  const derived = deriveProfilePackage(sourcePackage(), WORKTREE)
  assert.equal(derived.dsh.profile.bundles.filter((name) => name === COORDINATOR_PACKAGE).length, 1)
})

test('源 package.json 缺 dsh 段时也能派生', () => {
  const derived = deriveProfilePackage({ dependencies: {} }, WORKTREE)
  assert.deepEqual(derived.dsh.profile.bundles, [COORDINATOR_PACKAGE])
  assert.equal(derived.dependencies[COORDINATOR_PACKAGE], `link:${WORKTREE}`)
})

test('node_modules 逐条链到源，只有插件本体指工作树', () => {
  const plan = planNodeModules({
    sourceEntries: ['@deepseek-ai', 'dsh-coordinator', 'dsh-remind', '.pnpm'],
    existingEntries: [],
    sourceNodeModules: '/home/user/.dsh/profiles/web/node_modules',
    worktree: WORKTREE,
  })
  const byName = Object.fromEntries(plan.links.map((item) => [item.name, item.target]))
  assert.equal(byName['@deepseek-ai'], '/home/user/.dsh/profiles/web/node_modules/@deepseek-ai')
  assert.equal(byName['.pnpm'], '/home/user/.dsh/profiles/web/node_modules/.pnpm')
  assert.equal(byName[COORDINATOR_PACKAGE], WORKTREE)
  assert.deepEqual(plan.removals, [])
})

test('目标里多出来的条目要清掉，但插件本体不动', () => {
  const plan = planNodeModules({
    sourceEntries: ['@deepseek-ai'],
    existingEntries: ['@deepseek-ai', 'dsh-coordinator', 'stale-plugin'],
    sourceNodeModules: '/src/node_modules',
    worktree: WORKTREE,
  })
  assert.deepEqual(plan.removals, ['stale-plugin'])
  assert.equal(plan.links.length, 2)
})
