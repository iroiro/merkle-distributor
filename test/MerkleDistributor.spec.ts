import chai, { expect } from 'chai'
import { solidity, } from 'ethereum-waffle'
import {Contract, BigNumber, constants, Signer, ContractFactory} from 'ethers'
import BalanceTree from '../src/balance-tree'

import TestERC20 from '../build/TestERC20.json'
import { parseBalanceMap } from '../src/parse-balance-map'
import {ethers} from "hardhat";

chai.use(solidity)

const overrides = {
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

describe('MerkleDistributor', () => {
  let wallets: Signer[]
  let wallet0: Signer, wallet1: Signer;
  let token: Contract;
  let distFactory: ContractFactory

  beforeEach('deploy token', async () => {
    distFactory = await ethers.getContractFactory("MerkleDistributor");
    const Token = await ethers.getContractFactory("TestERC20");
    token = await Token.deploy("Token", "TKN", 0);
    wallets = await ethers.getSigners();
    [wallet0, wallet1] = wallets  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const distributor = await distFactory.deploy(token.address, ZERO_BYTES32)
      expect(await distributor.token()).to.eq(token.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const distributor = await distFactory.deploy(token.address, ZERO_BYTES32)
      expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = await distFactory.deploy(token.address, ZERO_BYTES32)
      await expect(distributor.claim(0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = await distFactory.deploy(token.address, ZERO_BYTES32)
      await expect(distributor.claim(0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
          { account: await wallet1.getAddress(), amount: BigNumber.from(101) },
        ])
        distributor = await distFactory.deploy(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, 201)
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, await wallet0.getAddress(), 100)
        const proof1 = tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101))
        await expect(distributor.claim(1, await wallet1.getAddress(), 101, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, await wallet1.getAddress(), 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect(await token.balanceOf(await wallet0.getAddress())).to.eq(0)
        await distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides)
        expect(await token.balanceOf(await wallet0.getAddress())).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await token.setBalance(distributor.address, 99)
        await expect(distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides)
        await expect(distributor.claim(0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claim(
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )
        await distributor.claim(
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )

        await expect(
          distributor.claim(0, await wallet0.getAddress(), 100, tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.claim(
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )
        await distributor.claim(
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )

        await expect(
          distributor.claim(1, await wallet1.getAddress(), 101, tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(distributor.claim(1, await wallet1.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(distributor.claim(0, await wallet0.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })
    })

    describe('larger tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          await Promise.all(wallets.map(async (wallet, ix) => {
            return { account: await wallet.getAddress(), amount: BigNumber.from(ix + 1) }
          }))
        )
        distributor = await distFactory.deploy(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, 201)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, await wallets[4].getAddress(), BigNumber.from(5))
        await expect(distributor.claim(4, await wallets[4].getAddress(), 5, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, await wallets[4].getAddress(), 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, await wallets[9].getAddress(), BigNumber.from(10))
        await expect(distributor.claim(9, await wallets[9].getAddress(), 10, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, await wallets[9].getAddress(), 10)
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []

      beforeEach('deploy', async () => {
        const walletAddress = await wallet0.getAddress()
        for (let i = 0; i < NUM_LEAVES; i++) {
          const node = { account: walletAddress, amount: BigNumber.from(100) }
          elements.push(node)
        }

        tree = new BalanceTree(elements)
        distributor = await distFactory.deploy(token.address, tree.getHexRoot())
        await token.setBalance(distributor.address, constants.MaxUint256)
      })

      it('proof verification works', async () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, await wallet0.getAddress(), BigNumber.from(100))
            .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, await wallet0.getAddress(), BigNumber.from(100), proof, root)
          expect(validProof).to.be.true
        }
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, await wallet0.getAddress(), BigNumber.from(100))
          await distributor.claim(i, await wallet0.getAddress(), 100, proof, overrides)
          await expect(distributor.claim(i, await wallet0.getAddress(), 100, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [account: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
        [await wallet0.getAddress()]: 200,
        [await wallet1.getAddress()]: 300,
        [await wallets[2].getAddress()]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = await distFactory.deploy(token.address, merkleRoot)
      await token.setBalance(distributor.address, tokenTotal)
    })

    it('check the proofs is as expected', async () => {
      expect(claims).to.deep.eq({
        [await wallet0.getAddress()]: {
          index: 2,
          amount: '0xc8',
          proof: [
            "0x0782528e118c4350a2465fbeabec5e72fff06991a29f21c08d37a0d275e38ddd",
            "0xf3c5acb53398e1d11dcaa74e37acc33d228f5da944fbdea9a918684074a21cdb"
          ],
        },
        [await wallet1.getAddress()]: {
          index: 1,
          amount: '0x012c',
          proof: [
            "0xc86fd316fa3e7b83c2665b5ccb63771e78abcc0429e0105c91dde37cb9b857a4",
            "0xf3c5acb53398e1d11dcaa74e37acc33d228f5da944fbdea9a918684074a21cdb"
          ],
        },
        [await wallets[2].getAddress()]: {
          index: 0,
          amount: '0xfa',
          proof: ["0x0c9bcaca2a1013557ef7f348b514ab8a8cd6c7051b69e46b1681a2aff22f4a88"],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, account, claim.amount)
        await expect(distributor.claim(claim.index, account, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(distributor.address)).to.eq(0)
    })
  })
})
