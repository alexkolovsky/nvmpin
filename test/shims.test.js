import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { readBins, writeShims, removeShims, parseShim, listShims, isNvmpinShim } from '../src/shims.js';
import { shimDir } from '../src/registry.js';
import { versionPath } from '../src/nvm.js';
import { UserError } from '../src/errors.js';
import { makeFixture, installFakePackage } from './fixtures/helpers.js';

test('shims: single-bin object form', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'onebin', { bin: { onebin: 'cli.js' } });
    const bins = readBins(fx.nvmDir, 'v18.20.4', 'onebin');
    assert.deepEqual(bins, { onebin: 'cli.js' });

    const written = writeShims(fx.home, fx.nvmDir, 'onebin', 'v18.20.4', bins);
    assert.deepEqual(written, ['onebin']);

    const shimFile = path.join(shimDir(fx.home), 'onebin');
    const content = fs.readFileSync(shimFile, 'utf8');
    const abs = path.resolve(versionPath(fx.nvmDir, 'v18.20.4'));
    assert.match(content, /^#!\/usr\/bin\/env bash\n/);
    assert.ok(content.includes(`exec "${abs}/bin/node" "${abs}/lib/node_modules/onebin/cli.js" "$@"`));
    assert.ok(fs.statSync(shimFile).mode & 0o100, 'shim is executable');
  } finally {
    fx.cleanup();
  }
});

test('shims: multi-bin package generates one shim per bin', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'multi', { bin: { alpha: 'bin/a.js', beta: './bin/b.js' } });
    const bins = readBins(fx.nvmDir, 'v18.20.4', 'multi');
    assert.deepEqual(bins, { alpha: 'bin/a.js', beta: 'bin/b.js' }); // ./ stripped
    const written = writeShims(fx.home, fx.nvmDir, 'multi', 'v18.20.4', bins);
    assert.deepEqual(written, ['alpha', 'beta']);
    assert.deepEqual(listShims(fx.home), ['alpha', 'beta']);
  } finally {
    fx.cleanup();
  }
});

test('shims: string-form bin uses package name (scope stripped)', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'strbin', { bin: 'index.js' });
    assert.deepEqual(readBins(fx.nvmDir, 'v18.20.4', 'strbin'), { strbin: 'index.js' });

    installFakePackage(fx.nvmDir, 'v18.20.4', '@scope/scoped-cli', { bin: 'run.js' });
    assert.deepEqual(readBins(fx.nvmDir, 'v18.20.4', '@scope/scoped-cli'), { 'scoped-cli': 'run.js' });
  } finally {
    fx.cleanup();
  }
});

test('shims: package without bin field is rejected', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'library-only', {});
    assert.throws(() => readBins(fx.nvmDir, 'v18.20.4', 'library-only'), UserError);
  } finally {
    fx.cleanup();
  }
});

test('shims: not-installed package is a user error', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    assert.throws(() => readBins(fx.nvmDir, 'v18.20.4', 'ghost'), /not installed/);
  } finally {
    fx.cleanup();
  }
});

test('shims: removeShims deletes only nvmpin-owned files', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', 'tool', { bin: { tool: 'cli.js' } });
    writeShims(fx.home, fx.nvmDir, 'tool', 'v18.20.4', { tool: 'cli.js' });
    const foreign = path.join(shimDir(fx.home), 'user-script');
    fs.writeFileSync(foreign, '#!/bin/bash\necho mine\n');
    removeShims(fx.home, ['tool', 'user-script']);
    assert.ok(!fs.existsSync(path.join(shimDir(fx.home), 'tool')));
    assert.ok(fs.existsSync(foreign), 'non-shim file untouched');
    assert.equal(isNvmpinShim(foreign), false);
  } finally {
    fx.cleanup();
  }
});

test('shims: parseShim round-trips pkg and version', () => {
  const fx = makeFixture(['v18.20.4']);
  try {
    installFakePackage(fx.nvmDir, 'v18.20.4', '@scope/tool', { bin: { stool: 'cli.js' } });
    writeShims(fx.home, fx.nvmDir, '@scope/tool', 'v18.20.4', { stool: 'cli.js' });
    const parsed = parseShim(path.join(shimDir(fx.home), 'stool'));
    assert.deepEqual(parsed, { pkg: '@scope/tool', version: 'v18.20.4' });
  } finally {
    fx.cleanup();
  }
});
