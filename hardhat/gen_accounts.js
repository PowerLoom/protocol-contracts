const { ethers } = require('ethers');

// Generate a random mnemonic (BIP39)
const walletMnemonic = 'enter secret mnemonic here';
console.log(`Mnemonic: ${walletMnemonic}`);

// Create a wallet from the mnemonic
const masterWallet = ethers.HDNodeWallet.fromPhrase(walletMnemonic);

// Generate 10 private keys from the same mnemonic
for (let i = 0; i < 10; i++) {
    const derivedWallet = masterWallet.deriveChild(i);
    console.log(`Private Key ${i + 1}: ${derivedWallet.privateKey}`);
    console.log(`Address: ${derivedWallet.address}`);
    console.log(`\n`);
}