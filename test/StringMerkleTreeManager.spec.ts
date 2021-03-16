import chai, { expect } from 'chai'
import { solidity, } from 'ethereum-waffle'
import {Contract, BigNumber, constants, utils, Signer, ContractFactory} from 'ethers'
import BalanceTree from '../src/string-balance-tree'

import { parseStringBalanceMap } from '../src/parse-string-balance-map'
import {ethers} from "hardhat";

chai.use(solidity)

const overrides = {
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ONE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000001'

describe('StringMerkleTreeManager', () => {
  let wallets: Signer[]
  let wallet0: Signer, wallet1: Signer;
  let managerFactory: ContractFactory

  beforeEach('deploy', async () => {
    managerFactory = await ethers.getContractFactory("StringMerkleTreeManager");
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
    it('returns the zero merkle root', async () => {
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

    describe('two hashes tree', () => {
      let manager: Contract
      let tree: BalanceTree
      let uuidList = [
        '42330217-bdab-440d-9500-2bb253ce547f',
        '89a11414-839a-4719-a8d9-d7774fbaf3c4'
      ]
      let hashedUUIDList = uuidList.map(uuid =>
          utils.solidityKeccak256(["string"], [uuid])
      )

      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
          { hashed: hashedUUIDList[1], amount: BigNumber.from(101) },
        ])
        manager = await managerFactory.deploy()
        await manager.addTree(tree.getHexRoot())
        await manager.addTree(tree.getHexRoot())
      })

      it('successful proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.proof(1, 0, uuidList[0], 100, proof0, overrides)
        const proof1 = tree.getProof(1, hashedUUIDList[1], BigNumber.from(101))
        await manager.connect(wallet1).proof(1, 1, uuidList[1], 101, proof1, overrides)
      })

      it('sets #isProven', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect(await manager.isProven(1, 0)).to.eq(false)
        expect(await manager.isProven(1, 1)).to.eq(false)
        await manager.proof(1, 0, uuidList[0], 100, proof0, overrides)
        expect(await manager.isProven(1, 0)).to.eq(true)
        expect(await manager.isProven(1, 1)).to.eq(false)
      })

      it('cannot allow two proofs', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.proof(1, 0, uuidList[0], 100, proof0, overrides)
        await expect(manager.proof(1, 0, uuidList[0], 100, proof0, overrides)).to.be.revertedWith(
            'MerkleTree: Already proven.'
        )
      })

      it('cannot proof more than once: 0 and then 1', async () => {
        await manager.proof(
            1,
            0,
            uuidList[0],
            100,
            tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
            overrides
        )
        await manager.proof(
            1,
            1,
            uuidList[1],
            101,
            tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
            overrides
        )

        await expect(
            manager.proof(1, 0, uuidList[0], 100, tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleTree: Already proven.')
      })

      it('cannot proof more than once: 1 and then 0', async () => {
        await manager.proof(
            1,
            1,
            uuidList[1],
            101,
            tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
            overrides
        )
        await manager.proof(
            1,
            0,
            uuidList[0],
            100,
            tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
            overrides
        )

        await expect(
            manager.proof(1, 1, uuidList[1], 101, tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleTree: Already proven.')
      })

      it('cannot proof for address other than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(manager.proof(1, 1, uuidList[1], 101, proof0, overrides)).to.be.revertedWith(
            'MerkleTree: Invalid proof.'
        )
      })

      it('cannot proof more than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(manager.proof(1, 0, uuidList[0], 101, proof0, overrides)).to.be.revertedWith(
            'MerkleTree: Invalid proof.'
        )
      })
    })

    describe('larger tree', () => {
      let manager: Contract
      let tree: BalanceTree
      let uuidList = [
        '42330217-bdab-440d-9500-2bb253ce547f',
        'be65e473-69d9-466b-8f96-02b8115af0a9',
        'e05b4872-a667-4ecf-ab07-fca7eecb121c',
        '1eeb0d6e-3352-48f2-9329-a62721b806cb',
        '6315fd5c-b73a-4d91-a294-08861fc8200b',
        '99b19a48-9699-470c-b625-b5bd48f29fe8',
        '47afab39-8c1d-4746-ad65-d0a3f5fbc14e',
        'a1f1945a-6d26-4993-b241-e851e1d8af38',
        'e4ca6942-c662-448d-b734-dd8dd0f84cf7',
        '89a11414-839a-4719-a8d9-d7774fbaf3c4'
      ]
      let hashedUUIDList = uuidList.map(uuid =>
          utils.solidityKeccak256(["string"], [uuid])
      )

      beforeEach('deploy', async () => {
        tree = new BalanceTree(
            hashedUUIDList.map((hashed, ix) => {
              return { hashed, amount: BigNumber.from(ix + 1) }
            })
        )
        manager = await managerFactory.deploy()

        await manager.addTree(tree.getHexRoot())
      })

      it('proof index 4', async () => {
        const proof = tree.getProof(4, hashedUUIDList[4], BigNumber.from(5))
        await manager.connect(wallets[4]).proof(1, 4, uuidList[4], 5, proof, overrides)
      })

      it('proof index 9', async () => {
        const proof = tree.getProof(9, hashedUUIDList[9], BigNumber.from(10))
        await manager.connect(wallets[9]).proof(1, 9, uuidList[9], 10, proof, overrides)
      })
    })

    describe('realistic size tree', () => {
      let manager: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { hashed: string; amount: BigNumber }[] = []

      const uuid =  "42330217-bdab-440d-9500-2bb253ce547f"
      const hashed= utils.solidityKeccak256(["string"], [uuid])
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { hashed, amount: BigNumber.from(100) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
              .getProof(i, hashed, BigNumber.from(100))
              .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, hashed, BigNumber.from(100), proof, root)
          expect(validProof).to.be.true
        }
      })

      beforeEach('deploy', async () => {
        manager = await managerFactory.deploy()
        await manager.addTree(tree.getHexRoot())
      })

      it('no double proofs in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, hashed, BigNumber.from(100))
          await manager.proof(1, i, uuid, 100, proof, overrides)
          await expect(manager.proof(1, i, uuid, 100, proof, overrides)).to.be.revertedWith(
              'MerkleTree: Already proven.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let manager: Contract
    let proofs: {
      [hashed: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    const rawUUIDs = {
      '6ccbe73b-2166-4109-816a-193c9dde9a14': 200,
      '71feb404-7871-4f30-b869-7d68c99f188b': 300,
      '23d6ba35-35bf-4de3-b21c-957504a645b1': 250,
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseStringBalanceMap({
        "0x6a6453940381804fa6671a1f1cd3f295f83d751339ed0d8930654d4cdfa5ad75": 200,
        "0x9ca955ecc2d281be4ed5348b0f7a79b263afd8b58d1cf5dbf34e8f53c5443184": 300,
        "0x1cca01e19858aa423f2195b7e5d071436f19a0cd0c1bf853e18e0ebf78328e5d": 250
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      proofs = innerClaims
      manager = await managerFactory.deploy()
      await manager.addTree(merkleRoot)
    })

    it('check the proofs is as expected', () => {
      expect(proofs).to.deep.eq({
        "0x1cca01e19858aa423f2195b7e5d071436f19a0cd0c1bf853e18e0ebf78328e5d": {
          "index": 0,
          "amount": "0xfa",
          "proof": [
            "0xa66e6dcec3ab90b2d3948523c8c74773bc8db96e53255fda607dc24f98575075",
            "0xd7a578f9f444e06f1ee830fbc0a3a031edd16181f58a47abc83b0bead3f74f78"
          ]
        },
        "0x6a6453940381804fa6671a1f1cd3f295f83d751339ed0d8930654d4cdfa5ad75": {
          "index": 1,
          "amount": "0xc8",
          "proof": [
            "0x49a271bb19c46d25f5f1e47b681f99551379fd4d17c2162c8c358a502a528425"
          ]
        },
        "0x9ca955ecc2d281be4ed5348b0f7a79b263afd8b58d1cf5dbf34e8f53c5443184": {
          "index": 2,
          "amount": "0x012c",
          "proof": [
            "0x977a7824f5ef91c1c6faaab9251ae86282683cc9718edb1e1fb97e799b43083d",
            "0xd7a578f9f444e06f1ee830fbc0a3a031edd16181f58a47abc83b0bead3f74f78"
          ]
        }
      })
    })

    const uuidMappings: { raw: string, hashed: string}[] = [
      {
        "raw": "6ccbe73b-2166-4109-816a-193c9dde9a14",
        "hashed": "0x6a6453940381804fa6671a1f1cd3f295f83d751339ed0d8930654d4cdfa5ad75",
      },
      {
        "raw": '71feb404-7871-4f30-b869-7d68c99f188b',
        "hashed": "0x9ca955ecc2d281be4ed5348b0f7a79b263afd8b58d1cf5dbf34e8f53c5443184",
      },
      {
        "raw": '23d6ba35-35bf-4de3-b21c-957504a645b1',
        "hashed": "0x1cca01e19858aa423f2195b7e5d071436f19a0cd0c1bf853e18e0ebf78328e5d",
      }
    ]

    it('all proofs work exactly once', async () => {
      for (let i = 0; i < uuidMappings.length; i++) {
        const proof = proofs[uuidMappings[i].hashed]
        await manager.proof(1, proof.index, uuidMappings[i].raw, proof.amount, proof.proof, overrides)
        await expect(manager.proof(1, proof.index, uuidMappings[i].raw, proof.amount, proof.proof, overrides)).to.be.revertedWith(
            'MerkleTree: Already proven.'
        )
      }
    })
  })

  describe("multiple distribution", () => {
    let manager: Contract
    let tree: BalanceTree
    let uuidList = [
      '42330217-bdab-440d-9500-2bb253ce547f',
      '89a11414-839a-4719-a8d9-d7774fbaf3c4'
    ]
    let hashedUUIDList = uuidList.map(uuid =>
        utils.solidityKeccak256(["string"], [uuid])
    )

    beforeEach(async () => {
      tree = new BalanceTree([
        { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
        { hashed: hashedUUIDList[1], amount: BigNumber.from(100) },
      ])
      manager = await managerFactory.deploy()
      await manager.addTree(tree.getHexRoot())
      await manager.addTree(tree.getHexRoot())
    });

    it("success", async () => {
      const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
      await manager.proof( 1, 0, uuidList[0], 100, proof0)
      await manager.proof( 2, 0, uuidList[0], 100, proof0)
    });
  });
})
