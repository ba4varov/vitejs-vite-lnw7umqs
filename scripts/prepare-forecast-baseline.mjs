import { execFileSync } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
const ref = 'c9a384aecf82104d50b1a2802baeae9e0010c9aa'
const root = 'work/baseline'
if (!existsSync(`${root}/.git`)) execFileSync('git', ['worktree', 'add', '--detach', root, ref], { stdio: 'inherit' })
const actual = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (actual !== ref) throw new Error(`Forecast baseline must be main after PR #89 (${ref})`)
if (execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Forecast baseline has local changes')
if (!existsSync(`${root}/node_modules`)) symlinkSync(resolve('node_modules'), `${root}/node_modules`, 'dir')
console.log(`Prepared independent forecast baseline ${ref}`)
