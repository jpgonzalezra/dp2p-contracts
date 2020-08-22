const BN = web3.utils.BN;

const expect = require('chai')
  .use(require('bn-chai')(BN))
  .expect;

module.exports.expect = expect;

module.exports.address0x = '0x0000000000000000000000000000000000000000';

module.exports.bn = (number) => {
  return web3.utils.toBN(number);
};

module.exports.maxUint = (base) => {
  return this.bn('2').pow(this.bn(base)).sub(this.bn('1'));
};

module.exports.random32bn = () => {
  return this.bn(this.random32());
};

module.exports.random32 = () => {
  return web3.utils.randomHex(32);
};

// the promiseFunction should be a function
module.exports.tryCatchRevert = async (promise, message, headMsg = 'revert ') => {
  if (message === '') {
    headMsg = headMsg.slice(0, -1);
    console.log('    \u001b[93m\u001b[2m\u001b[1m⬐ Warning:\u001b[0m\u001b[30m\u001b[1m There is an empty revert/require message');
  }
  try {
    if (promise instanceof Function)
      await promise();
    else
      await promise;
  } catch (error) {
    assert(
      error.message.search(headMsg + message) >= 0 || process.env.SOLIDITY_COVERAGE,
      'Expected a revert \'' + headMsg + message + '\', got \'' + error.message + '\' instead'
    );
    return;
  }
  throw new Error('Expected throw not received');
};

module.exports.toEvents = async (tx, ...events) => {
  if (tx instanceof Promise)
    tx = await tx;

  const logs = tx.logs;

  let eventObjs = [].concat.apply(
    [],
    events.map(
      event => logs.filter(
        log => log.event === event
      )
    )
  );

  if (eventObjs.length === 0 || eventObjs.some(x => x === undefined)) {
    console.log('\t\u001b[91m\u001b[2m\u001b[1mError: The event dont find');
    assert.fail();
  }
  eventObjs = eventObjs.map(x => x.args);
  return (eventObjs.length === 1) ? eventObjs[0] : eventObjs;
};

module.exports.fixSignature = (signature) => {
  // in geth its always 27/28, in ganache its 0/1. Change to 27/28 to prevent
  // signature malleability if version is 0/1
  // see https://github.com/ethereum/go-ethereum/blob/v1.8.23/internal/ethapi/api.go#L465
  let v = parseInt(signature.slice(130, 132), 16);
  if (v < 27)
    v += 27;

  const vHex = v.toString(16);
  return signature.slice(0, 130) + vHex;
};
