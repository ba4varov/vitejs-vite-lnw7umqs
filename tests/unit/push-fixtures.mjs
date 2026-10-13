import {createECDH} from 'node:crypto'
// Public, deterministic test-only scalars. Never use for a real subscription or configuration.
export function fixtureKeys(value=1) {
 const privateBytes=Buffer.alloc(32);privateBytes[31]=value
 const curve=createECDH('prime256v1');curve.setPrivateKey(privateBytes)
 return {publicKey:curve.getPublicKey().toString('base64url'),privateKey:privateBytes.toString('base64url')}
}
