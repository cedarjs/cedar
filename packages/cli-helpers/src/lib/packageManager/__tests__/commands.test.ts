import { describe, it, expect } from 'vitest'

import {
  installPackagesFor,
  addRootPackages,
  addWorkspacePackages,
  runScript,
  runWorkspaceScript,
  runBin,
  runWorkspaceBin,
  dlx,
  dedupe,
} from '../commands.js'

describe('command generators', () => {
  describe('installPackagesFor', () => {
    it('returns yarn install', () => {
      expect(installPackagesFor('yarn')).toEqual({
        command: 'yarn',
        args: ['install'],
      })
    })
    it('returns npm install', () => {
      expect(installPackagesFor('npm')).toEqual({
        command: 'npm',
        args: ['install'],
      })
    })
    it('returns pnpm install', () => {
      expect(installPackagesFor('pnpm')).toEqual({
        command: 'pnpm',
        args: ['install'],
      })
    })
  })

  describe('addRootPackages', () => {
    it('yarn add', () => {
      expect(addRootPackages(['pkg1'], 'yarn')).toEqual({
        command: 'yarn',
        args: ['add', 'pkg1'],
      })
    })
    it('npm install', () => {
      expect(addRootPackages(['pkg1'], 'npm')).toEqual({
        command: 'npm',
        args: ['install', 'pkg1'],
      })
    })
    it('pnpm add', () => {
      expect(addRootPackages(['pkg1'], 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['add', 'pkg1'],
      })
    })
    it('dev dependency', () => {
      expect(addRootPackages(['pkg1'], 'npm', { dev: true })).toEqual({
        command: 'npm',
        args: ['install', '-D', 'pkg1'],
      })
    })
  })

  describe('addWorkspacePackages', () => {
    it('yarn workspace', () => {
      expect(addWorkspacePackages('web', ['pkg1'], 'yarn')).toEqual({
        command: 'yarn',
        args: ['workspace', 'web', 'add', 'pkg1'],
      })
    })
    it('npm workspace', () => {
      expect(addWorkspacePackages('web', ['pkg1'], 'npm')).toEqual({
        command: 'npm',
        args: ['install', 'pkg1', '-w', 'web'],
      })
    })
    it('pnpm workspace', () => {
      expect(addWorkspacePackages('web', ['pkg1'], 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['add', 'pkg1', '--filter', 'web'],
      })
    })
  })

  describe('runScript', () => {
    it('yarn run', () => {
      expect(runScript('test', 'yarn')).toEqual({
        command: 'yarn',
        args: ['test'],
      })
    })
    it('npm run', () => {
      expect(runScript('test', 'npm')).toEqual({
        command: 'npm',
        args: ['run', 'test', '--'],
      })
    })
    it('pnpm run', () => {
      expect(runScript('test', 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['test'],
      })
    })
  })

  describe('runWorkspaceScript', () => {
    it('yarn workspace script', () => {
      expect(runWorkspaceScript('web', 'test', 'yarn')).toEqual({
        command: 'yarn',
        args: ['workspace', 'web', 'test'],
      })
    })
    it('npm workspace script', () => {
      expect(runWorkspaceScript('web', 'test', 'npm')).toEqual({
        command: 'npm',
        args: ['run', 'test', '-w', 'web', '--'],
      })
    })
    it('pnpm workspace script', () => {
      expect(runWorkspaceScript('web', 'test', 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['test', '--filter', 'web'],
      })
    })
  })

  describe('runBin', () => {
    it('yarn bin', () => {
      expect(runBin('tsc', [], 'yarn')).toEqual({
        command: 'yarn',
        args: ['tsc'],
      })
    })
    it('npm bin (npx)', () => {
      expect(runBin('tsc', [], 'npm')).toEqual({
        command: 'npx',
        args: ['tsc'],
      })
    })
    it('pnpm bin (exec)', () => {
      expect(runBin('tsc', [], 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['exec', 'tsc'],
      })
    })
  })

  describe('runWorkspaceBin', () => {
    it('yarn workspace bin', () => {
      expect(runWorkspaceBin('web', 'tsc', [], 'yarn')).toEqual({
        command: 'yarn',
        args: ['workspace', 'web', 'tsc'],
      })
    })
    it('npm workspace bin (exec)', () => {
      expect(runWorkspaceBin('web', 'tsc', [], 'npm')).toEqual({
        command: 'npm',
        args: ['exec', '-w', 'web', '--', 'tsc'],
      })
    })
    it('pnpm workspace bin (exec)', () => {
      expect(runWorkspaceBin('web', 'tsc', [], 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['exec', '--filter', 'web', 'tsc'],
      })
    })
  })

  describe('dlx', () => {
    it('yarn dlx', () => {
      expect(dlx('create-cedar-app', [], 'yarn')).toEqual({
        command: 'yarn',
        args: ['dlx', 'create-cedar-app'],
      })
    })
    it('npm dlx (npx)', () => {
      expect(dlx('create-cedar-app', [], 'npm')).toEqual({
        command: 'npx',
        args: ['create-cedar-app'],
      })
    })
    it('pnpm dlx', () => {
      expect(dlx('create-cedar-app', [], 'pnpm')).toEqual({
        command: 'pnpm',
        args: ['dlx', 'create-cedar-app'],
      })
    })
  })

  describe('dedupe', () => {
    it('returns dedupe command for yarn', () => {
      expect(dedupe('yarn')).toEqual({ command: 'yarn', args: ['dedupe'] })
    })
    it('returns null for npm', () => {
      expect(dedupe('npm')).toBeNull()
    })
    it('returns null for pnpm', () => {
      expect(dedupe('pnpm')).toBeNull()
    })
  })
})
