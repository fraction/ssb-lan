const pull = require('pull-stream');
const tape = require('tape');
const Keys = require('ssb-keys');
const broadcast = require('broadcast-stream');
const port = require('../port');
const Ref = require('ssb-ref');

const createSsbServer = require('ssb-server').use(require('../lib/index'));

tape.skip('(LEGACY) broadcasting looks correct', t => {
  t.plan(7);

  const keys = Keys.generate();
  const alice = createSsbServer({
    temp: 'test-lan-alice',
    timeout: 1000,
    port: 8008,
    keys,
  });
  alice.lan.start();

  const b = broadcast(port);
  b.on('data', buf => {
    const msg = JSON.parse(buf.toString());

    t.equals(typeof msg.address, 'string', 'address is a string');
    t.ok(msg.address, 'address is okay');
    t.equals(msg.address.slice(0, 4), 'net:', 'address begins with net:');

    t.equals(typeof msg.capsHash, 'string', 'capsHash is a string');
    t.ok(msg.capsHash, 'capsHash is okay');

    t.equals(typeof msg.signature, 'string', 'signature is a string');
    t.ok(msg.signature, 'signature is okay');

    b.close();
    alice.lan.stop();
    alice.close();
    t.end();
  });
});

tape('broadcast write is correct', t => {
  t.plan(6);

  const keys = Keys.generate();
  const alice = createSsbServer({
    temp: 'test-lan-alice1',
    timeout: 1000,
    port: 8008,
    keys,
  });
  alice.lan.start();

  const b = broadcast(port);
  b.on('data', buf => {
    try {
      JSON.parse(buf.toString());
      t.fail('JSON parsing must fail');
    } catch (err) {
      t.ok(err, 'JSON parsing should fail, because it is ciphertext');
    }
    t.true(buf.length > 64, 'UDP payload has many bytes');

    const ciphertext = buf.slice(0, buf.length - 64);
    t.true(ciphertext.length > 64, 'ciphertext has many bytes');

    const sig = buf.slice(buf.length - 64, buf.length);
    const signature = sig.toString('base64') + '.sig.ed25519';
    t.equals(sig.length, 64, 'signature has 64 bytes');

    const {address} = Keys.secretUnbox(ciphertext, alice.config.caps.shs);
    t.true(Ref.isAddress(address), 'plaintext is a multiserver address');

    const {key} = Ref.parseAddress(address);
    const verification = Keys.verifyObj({public: key}, {address, signature});
    t.true(verification, 'signature is verified');

    b.close();
    alice.lan.stop();
    alice.close();
    t.end();
  });
});

tape('broadcast read is correct', t => {
  t.plan(4);

  const aliceKeys = Keys.generate();
  const alice = createSsbServer({
    temp: 'test-lan-alice2',
    timeout: 1000,
    port: 8009,
    keys: aliceKeys,
  });
  alice.lan.start();

  pull(
    alice.lan.discoveredPeers(),
    pull.drain(discovery => {
      t.equals(typeof discovery.address, 'string', 'address is a string');
      t.ok(discovery.address, 'address is okay');
      t.equals(
        discovery.address.slice(0, 4),
        'net:',
        'address begins with net:',
      );

      t.true(discovery.verified, 'discovery is verified');

      b.close();
      alice.lan.stop();
      alice.close();
      t.end();
    }),
  );

  const bobKeys = Keys.generate();
  const address =
    'net:192.168.1.11:26830~shs:' + bobKeys.public.replace(/\.ed25519$/, '');
  const ciphertext = Keys.secretBox({address}, alice.config.caps.shs);
  const b64signature = Keys.signObj(bobKeys, {address}).signature;
  const signature = Buffer.from(
    b64signature.replace(/\.sig\.ed25519$/, ''),
    'base64',
  );
  const payload = Buffer.concat([ciphertext, signature]);

  const b = broadcast(port, true);
  b.write(payload);
});
