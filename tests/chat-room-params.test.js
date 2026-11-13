const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../js/chat-room.js'), 'utf8');
const start = source.indexOf('    function validId(value)');
const end = source.indexOf('    function showSetup(params)');
assert.ok(start >= 0 && end > start, 'URL parameter functions not found in chat-room.js');
const constants = ['DEFAULT_WORKSPACE_ID', 'MAX_ID_LENGTH', 'AVATAR_ALIASES']
  .map(name => source.match(new RegExp(`const ${name}[^\\n]+\\n`))[0]).join('');

// Runs the page's readParams() against the given query string.
function readParams(search) {
  const context = vm.createContext({
    URLSearchParams, Object,
    window: { location: { search } },
    Avatar: Object.freeze({ HUMAN_MANAGER: 'human-manager', AI_AGENT: 'ai-agent' })
  });
  vm.runInContext(constants + source.slice(start, end) + '\nthis.readParams = readParams;', context);
  return context.readParams();
}

test('workspace defaults to secure-chat', () => {
  assert.equal(readParams('?channelId=room-1&accountId=anna').workspaceId, 'secure-chat');
  assert.equal(readParams('?channelId=room-1&accountId=anna&workspaceId=%20%20').workspaceId, 'secure-chat');
});

test('workspaceId picks another workspace, e.g. for comagents agent session chats', () => {
  const params = readParams('?channelId=code_review_session_1&accountId=MBugai&avatar=human-manager'
    + '&workspaceId=comagents-secure-chat');
  assert.equal(params.workspaceId, 'comagents-secure-chat');
  assert.equal(params.channelId, 'code_review_session_1');
  assert.equal(params.accountId, 'MBugai');
});

test('an invalid workspaceId falls back to the default', () => {
  assert.equal(readParams(`?workspaceId=${'x'.repeat(129)}`).workspaceId, 'secure-chat');
  assert.equal(readParams('?workspaceId=a%07b').workspaceId, 'secure-chat');
});
