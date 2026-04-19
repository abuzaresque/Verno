/**
 * Extension tests
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Extension activation', async function() {
    this.timeout(10000); // Increase timeout to 10 seconds
    const ext = vscode.extensions.getExtension('verno-ai.verno');
    assert.ok(ext, 'Extension should be found');

    await ext?.activate();
    assert.ok(ext?.isActive, 'Extension should be active');
  });

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
