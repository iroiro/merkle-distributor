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
const ONE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000001'

describe('MerkleTreeManager', () => {
  let wallets: Signer[]
  let wallet0: Signer, wallet1: Signer;
  let managerFactory: ContractFactory

  beforeEach('deploy', async () => {
    managerFactory = await ethers.getContractFactory("MerkleTreeManager");
    wallets = await ethers.getSigners();
    [wallet0, wallet1] = wallets
  })

  describe('#distributionId', () => {
    it('increment when distribution is added', async () => {
      const manager = await managerFactory.deploy()
      expect(await manager.nextTreeId()).to.eq(1)
      await manager.addTree(ZERO_BYTES32)
      expect(await manager.nextTreeId()).to.eq(2)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the merkle root', async () => {
      const manager = await managerFactory.deploy()
      await manager.addTree(ZERO_BYTES32)
      expect(await manager.merkleRoot(1)).to.eq(ZERO_BYTES32)
      await manager.addTree(ONE_BYTES32)
      expect(await manager.merkleRoot(2)).to.eq(ONE_BYTES32)
    })
  })

  describe('#proof', () => {
    it('fails for empty proof', async () => {
      const manager = await managerFactory.deploy()
      await manager.addTree(ZERO_BYTES32)
      await expect(manager.proof(1, 0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleTree: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const manager = await managerFactory.deploy()
      await manager.addTree(ZERO_BYTES32)
      await expect(manager.proof(1, 0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleTree: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let manager: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
          { account: await wallet1.getAddress(), amount: BigNumber.from(101) },
        ])
        manager = await managerFactory.deploy()
        await manager.addTree(tree.getHexRoot())
        await manager.addTree(tree.getHexRoot())
      })

      it('successful proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.proof(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        const proof1 = tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101))
        await manager.proof(1, 1, await wallet1.getAddress(), 101, proof1, overrides)
      })

      it('sets #isProven', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect(await manager.isProven(1, 0)).to.eq(false)
        expect(await manager.isProven(1, 1)).to.eq(false)
        await manager.proof(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        expect(await manager.isProven(1, 0)).to.eq(true)
        expect(await manager.isProven(1, 1)).to.eq(false)
      })

      it('cannot allow two proofs', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.proof(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        await expect(manager.proof(1, 0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'MerkleTree: Already proven.'
        )
      })

      it('cannot proof more than once: 0 and then 1', async () => {
        await manager.proof(
          1,
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )
        await manager.proof(
          1,
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )

        await expect(
          manager.proof(1, 0, await wallet0.getAddress(), 100, tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleTree: Already proven.')
      })

      it('cannot proof more than once: 1 and then 0', async () => {
        await manager.proof(
          1,
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )
        await manager.proof(
          1,
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )

        await expect(
          manager.proof(
              1,
              1,
              await wallet1.getAddress(),
              101,
              tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
              overrides
          )
        ).to.be.revertedWith('MerkleTree: Already proven.')
      })

      it('cannot proof for address other than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.proof(1, 1, await wallet1.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
          'MerkleTree: Invalid proof.'
        )
      })

      it('cannot proof more than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.proof(1, 0, await wallet0.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
            'MerkleTree: Invalid proof.'
        )
      })
    })

    describe('larger tree', () => {
      let manager: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
            await Promise.all(wallets.map(async (wallet, ix) => {
              return { account: await wallet.getAddress(), amount: BigNumber.from(ix + 1) }
            }))
        )
        manager = await managerFactory.deploy()

        await manager.addTree(tree.getHexRoot())
      })

      it('proof index 4', async () => {
        const proof = tree.getProof(4, await wallets[4].getAddress(), BigNumber.from(5))
        await manager.proof(1, 4, await wallets[4].getAddress(), 5, proof, overrides)
      })

      it('proof index 9', async () => {
        const proof = tree.getProof(9, await wallets[9].getAddress(), BigNumber.from(10))
        await manager.proof(1, 9, await wallets[9].getAddress(), 10, proof, overrides)
      })
    })

    describe('realistic size tree', () => {
      let manager: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []

      beforeEach('deploy', async () => {
        const walletAddress = await wallet0.getAddress()
        for (let i = 0; i < NUM_LEAVES; i++) {
          const node = {account: walletAddress, amount: BigNumber.from(100)}
          elements.push(node)
        }
        tree = new BalanceTree(elements)

        manager = await managerFactory.deploy()
        await manager.addTree(tree.getHexRoot())
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

      it('no double proofs in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, await wallet0.getAddress(), BigNumber.from(100))
          await manager.proof(1, i, await wallet0.getAddress(), 100, proof, overrides)
          await expect(manager.proof(1, i, await wallet0.getAddress(), 100, proof, overrides)).to.be.revertedWith(
            'MerkleTree: Already proven.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let manager: Contract
    let proofs: {
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
      proofs = innerClaims
      manager = await managerFactory.deploy()
      await manager.addTree(merkleRoot)
    })

    it('check the proofs is as expected', async () => {
      expect(proofs).to.deep.eq({
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
            '0xc86fd316fa3e7b83c2665b5ccb63771e78abcc0429e0105c91dde37cb9b857a4',
            '0xf3c5acb53398e1d11dcaa74e37acc33d228f5da944fbdea9a918684074a21cdb',
          ],
        },
        [await wallets[2].getAddress()]: {
          index: 0,
          amount: '0xfa',
          proof: [
            "0x0c9bcaca2a1013557ef7f348b514ab8a8cd6c7051b69e46b1681a2aff22f4a88",
          ],
        },
      })
    })

    it('all proofs work exactly once', async () => {
      for (let account in proofs) {
        const proof = proofs[account]
        await manager.proof(1, proof.index, account, proof.amount, proof.proof, overrides)
        await expect(manager.proof(1, proof.index, account, proof.amount, proof.proof, overrides)).to.be.revertedWith(
          'MerkleTree: Already proven.'
        )
      }
    })
  })

  describe("multiple distribution", () => {
    let manager: Contract
    let tree: BalanceTree
    beforeEach(async () => {
      tree = new BalanceTree([
        { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
        { account: await wallet1.getAddress(), amount: BigNumber.from(100) }
      ])
      manager = await managerFactory.deploy()
      await manager.addTree(tree.getHexRoot())
      await manager.addTree(tree.getHexRoot())
    });

    it("success", async () => {
      const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
      await manager.proof( 1, 0, await wallet0.getAddress(), 100, proof0)
      await manager.proof( 2, 0, await wallet0.getAddress(), 100, proof0)
    });
  });
})
