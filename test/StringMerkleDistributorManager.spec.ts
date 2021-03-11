import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import {Contract, BigNumber, constants, utils} from 'ethers'
import BalanceTree from '../src/string-balance-tree'

import DistributorManager from '../build/StringMerkleDistributorManager.json'
import TestERC20 from '../build/TestERC20.json'
import { parseStringBalanceMap } from '../src/parse-string-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ONE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000001'

describe('StringMerkleDistributorManager', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })

  const wallets = provider.getWallets()
  const [wallet0, wallet1] = wallets

  let token: Contract
  let token2: Contract

  beforeEach('deploy token', async () => {
    token = await deployContract(wallet0, TestERC20, ['Token', 'TKN', 0], overrides)
    token2 = await deployContract(wallet0, TestERC20, ['Token2', 'TKN2', 0], overrides)
  })

  it('fails for no approve', async () => {
    const manager = await deployContract(wallet0, DistributorManager, [], overrides)
    await expect(manager.addDistribution(token.address, ZERO_BYTES32, 1, []))
        .to.be.revertedWith( 'ERC20: transfer amount exceeds balance' )
  })

  describe('#distributionId', () => {
    it('increment when distribution is added', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, 3)
      await token.approve(manager.address, 3)
      expect(await manager.nextDistributionId()).to.eq(1)
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.nextDistributionId()).to.eq(2)
    })
  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.token(1)).to.eq(token.address)
      await manager.addDistribution(token2.address, ONE_BYTES32, 0, [])
      expect(await manager.token(2)).to.eq(token2.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.merkleRoot(1)).to.eq(ZERO_BYTES32)
      await manager.addDistribution(token.address, ONE_BYTES32, 0, [])
      expect(await manager.merkleRoot(2)).to.eq(ONE_BYTES32)
    })
  })

  describe('#remainingAmount', () => {
    it('returns the remaining amount', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.remainingAmount(1)).to.eq(0)
      await token.setBalance(wallet0.address, 1)
      await token.approve(manager.address, 1)
      await manager.addDistribution(token.address, ONE_BYTES32, 1, [])
      expect(await manager.remainingAmount(2)).to.eq(1)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, 10)
      await token.approve(manager.address, 10)
      await manager.addDistribution(token.address, ZERO_BYTES32, 10, [])
      await expect(manager.claim(1, 0, wallet0.address, 10, [])).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, 10)
      await token.approve(manager.address, 10)
      await manager.addDistribution(token.address, ZERO_BYTES32, 10, [])
      await expect(manager.claim(1, 0, wallet0.address, 10, [])).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
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
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, [])
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(manager.claim(1, 0, uuidList[0], 100, proof0, overrides))
            .to.emit(manager, 'Claimed')
            .withArgs(1, wallet0.address, 100)
        const proof1 = tree.getProof(1, hashedUUIDList[1], BigNumber.from(101))
        await expect(manager.connect(wallet1).claim(1, 1, uuidList[1], 101, proof1, overrides))
            .to.emit(manager, 'Claimed')
            .withArgs(1, wallet1.address, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address)).to.eq(0)
        await manager.claim(1, 0, uuidList[0], 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const localmanager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 99)
        await token.approve(localmanager.address, 99)
        await localmanager.addDistribution(token.address, tree.getHexRoot(), 99, [])
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(localmanager.claim(1, 0, uuidList[0], 100, proof0, overrides)).to.be.revertedWith(
            'Insufficient token.'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect(await manager.isClaimed(1, 0)).to.eq(false)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
        await manager.claim(1, 0, uuidList[0], 100, proof0, overrides)
        expect(await manager.isClaimed(1, 0)).to.eq(true)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.claim(1, 0, uuidList[0], 100, proof0, overrides)
        await expect(manager.claim(1, 0, uuidList[0], 100, proof0, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await manager.claim(
            1,
            0,
            uuidList[0],
            100,
            tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
            overrides
        )
        await manager.claim(
            1,
            1,
            uuidList[1],
            101,
            tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
            overrides
        )

        await expect(
            manager.claim(1, 0, uuidList[0], 100, tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await manager.claim(
            1,
            1,
            uuidList[1],
            101,
            tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
            overrides
        )
        await manager.claim(
            1,
            0,
            uuidList[0],
            100,
            tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
            overrides
        )

        await expect(
            manager.claim(1, 1, uuidList[1], 101, tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(manager.claim(1, 1, uuidList[1], 101, proof0, overrides)).to.be.revertedWith(
            'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(manager.claim(1, 0, uuidList[0], 101, proof0, overrides)).to.be.revertedWith(
            'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        const proof = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        const tx = await manager.claim(1, 0, uuidList[0], 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(88283)
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
        manager = await deployContract(wallet0, DistributorManager, [], overrides)

        await token.setBalance(wallet0.address, 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, overrides)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, hashedUUIDList[4], BigNumber.from(5))
        await expect(manager.connect(wallets[4]).claim(1, 4, uuidList[4], 5, proof, overrides))
            .to.emit(manager, 'Claimed')
            .withArgs(1, wallets[4].address, 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, hashedUUIDList[9], BigNumber.from(10))
        await expect(manager.connect(wallets[9]).claim(1, 9, uuidList[9], 10, proof, overrides))
            .to.emit(manager, 'Claimed')
            .withArgs(1, wallets[9].address, 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, hashedUUIDList[9], BigNumber.from(10))
        const tx = await manager.claim(1, 9, uuidList[9], 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(90733)
      })

      it('gas second down about 15k', async () => {
        await manager.claim(
            1,
            0,
            uuidList[0],
            1,
            tree.getProof(0, hashedUUIDList[0], BigNumber.from(1)),
            overrides
        )
        const tx = await manager.claim(
            1,
            1,
            uuidList[1],
            2,
            tree.getProof(1, hashedUUIDList[1], BigNumber.from(2)),
            overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(59112)
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
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, constants.MaxUint256)
        await token.approve(manager.address, constants.MaxUint256)
        await manager.addDistribution(token.address, tree.getHexRoot(), constants.MaxUint256, [])
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, hashed, BigNumber.from(100))
          await manager.claim(1, i, uuid, 100, proof, overrides)
          await expect(manager.claim(1, i, uuid, 100, proof, overrides)).to.be.revertedWith(
              'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('gas prices for situations ', () => {
    let manager: Contract
    let tree: BalanceTree
    const NUM_LEAVES_LIST = [40, 50, 60]
    const NUM_SAMPLES_LIST = [5, 10, 20]
    const GAS_LIST = [92368, 92368, 92368]
    const SECOND_GAS_LIST = [62392, 62392, 62392]
    const DEEPER_NODE_GAS_LIST = [92402, 92402, 92402]
    const AVERAGE_GAS_LIST = [68385, 65383, 63853]
    const FIRST25_AVERAGE_GAS_LIST = [63497, 63497, 63497]
    const ALL_AVERAGE_GAS_LIST = [63084, 62947, 62840]

    for(let j = 0; j < NUM_LEAVES_LIST.length; j++) {
      describe(`leaves: ${NUM_LEAVES_LIST[j]}`, () => {
        const elements: { hashed: string; amount: BigNumber }[] = []
        const uuid =  "42330217-bdab-440d-9500-2bb253ce547f"
        const hashed= utils.solidityKeccak256(["string"], [uuid])
        for (let i = 0; i < NUM_LEAVES_LIST[j]; i++) {
          const node = { hashed, amount: BigNumber.from(100) }
          elements.push(node)
        }
        tree = new BalanceTree(elements)

        beforeEach('deploy', async () => {
          manager = await deployContract(wallet0, DistributorManager, [], overrides)
          await token.setBalance(wallet0.address, constants.MaxUint256)
          await token.approve(manager.address, constants.MaxUint256)
          await manager.addDistribution(token.address, tree.getHexRoot(), constants.MaxUint256, [])
        })

        it('gas', async () => {
          const proof = tree.getProof(0, hashed, BigNumber.from(100))
          const tx = await manager.claim(1, 0, uuid, 100, proof, overrides)
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(GAS_LIST[j])
        })

        it('gas second down about 15k', async () => {
          const proof1 = tree.getProof(0, hashed, BigNumber.from(100))
          await manager.claim(1, 0, uuid, 100, proof1, overrides)
          const proof2 = tree.getProof(1, hashed, BigNumber.from(100))
          const tx2 = await manager.claim(1, 1, uuid, 100, proof2, overrides)
          const receipt = await tx2.wait()
          expect(receipt.gasUsed).to.eq(SECOND_GAS_LIST[j])
        })

        it('gas deeper node', async () => {
          const proof = tree.getProof(55, hashed, BigNumber.from(100))
          const tx = await manager.claim(1, 55, uuid, 100, proof, overrides)
          const receipt = await tx.wait()
          expect(receipt.gasUsed).to.eq(DEEPER_NODE_GAS_LIST[j])
        })

        it('gas average random distribution', async () => {
          let total: BigNumber = BigNumber.from(0)
          let count: number = 0
          for (let i = 0; i < NUM_LEAVES_LIST[j]; i += NUM_LEAVES_LIST[j] / NUM_SAMPLES_LIST[j]) {
            const proof = tree.getProof(i, hashed, BigNumber.from(100))
            const tx = await manager.claim(1, i, uuid, 100, proof, overrides)
            const receipt = await tx.wait()
            total = total.add(receipt.gasUsed)
            count++
          }
          const average = total.div(count)
          expect(average).to.eq(AVERAGE_GAS_LIST[j])
        })

        // this is what we gas golfed by packing the bitmap
        it('gas average first 25', async () => {
          let total: BigNumber = BigNumber.from(0)
          let count: number = 0
          for (let i = 0; i < 25; i++) {
            const proof = tree.getProof(i, hashed, BigNumber.from(100))
            const tx = await manager.claim(1, i, uuid, 100, proof, overrides)
            const receipt = await tx.wait()
            total = total.add(receipt.gasUsed)
            count++
          }
          const average = total.div(count)
          expect(average).to.eq(FIRST25_AVERAGE_GAS_LIST[j])
        })

        it('gas average of all', async () => {
          let total: BigNumber = BigNumber.from(0)
          let count: number = 0
          for (let i = 0; i < NUM_LEAVES_LIST[j]; i++) {
            const proof = tree.getProof(i, hashed, BigNumber.from(100))
            const tx = await manager.claim(1, i, uuid, 100, proof, overrides)
            const receipt = await tx.wait()
            total = total.add(receipt.gasUsed)
            count++
          }
          const average = total.div(count)
          expect(average).to.eq(ALL_AVERAGE_GAS_LIST[j])
        })
      })
    }
  })

  describe('parseBalanceMap', () => {
    let manager: Contract
    let claims: {
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
      claims = innerClaims
      manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, tokenTotal)
      await token.approve(manager.address, tokenTotal)
      await manager.addDistribution(token.address, merkleRoot, tokenTotal, [])    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
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

    it('all claims work exactly once', async () => {
      for (let i = 0; i < uuidMappings.length; i++) {
        const claim = claims[uuidMappings[i].hashed]
        await expect(manager.claim(1, claim.index, uuidMappings[i].raw, claim.amount, claim.proof, overrides))
            .to.emit(manager, 'Claimed')
            .withArgs(1, wallet0.address, claim.amount)
        await expect(manager.claim(1, claim.index, uuidMappings[i].raw, claim.amount, claim.proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(manager.address)).to.eq(0)
    })
  })

  describe('gas prices for multiple distribution', () => {
    let manager: Contract
    let tree: BalanceTree
    const NUM_LEAVES = 40
    const elements: { hashed: string; amount: BigNumber }[] = []

    const uuid =  "42330217-bdab-440d-9500-2bb253ce547f"
    const hashed= utils.solidityKeccak256(["string"], [uuid])
    for (let i = 0; i < NUM_LEAVES; i++) {
      const node = { hashed, amount: BigNumber.from(100) }
      elements.push(node)
    }
    tree = new BalanceTree(elements)

    beforeEach('deploy', async () => {
      manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, 100000)
      await token.approve(manager.address, 100000)
      const tx1 = await manager.addDistribution(token.address, tree.getHexRoot(), 100000, [])
      const receipt1 = await tx1.wait()
      expect(receipt1.gasUsed).to.eq(100531)
      await token.setBalance(wallet0.address, 100000)
      await token.approve(manager.address, BigNumber.from(100000))
      const tx2 = await manager.addDistribution(token.address, tree.getHexRoot(), BigNumber.from(100000), [])
      const receipt2 = await tx2.wait()
      expect(receipt2.gasUsed).to.eq(85531)
    })

    it('gas differences', async () => {
      // first distribution, first claim
      const proof1 = tree.getProof(0, hashed, BigNumber.from(100))
      const tx1 = await manager.claim(1, 0, uuid, 100, proof1, overrides)
      const receipt1 = await tx1.wait()
      expect(receipt1.gasUsed).to.eq(92390)

      // second distribution, first claim
      const proof2 = tree.getProof(0, hashed, BigNumber.from(100))
      const tx2 = await manager.claim(2, 0, uuid, 100, proof2, overrides)
      const receipt2 = await tx2.wait()
      expect(receipt2.gasUsed).to.eq(77390)

      // first distribution, second claim
      const proof3 = tree.getProof(1, hashed, BigNumber.from(100))
      const tx3 = await manager.claim(1, 1, uuid, 100, proof3, overrides)
      const receipt3 = await tx3.wait()
      expect(receipt3.gasUsed).to.eq(62402)

      // second distribution, second claim
      const proof4 = tree.getProof(1, hashed, BigNumber.from(100))
      const tx4 = await manager.claim(2, 1, uuid, 100, proof4, overrides)
      const receipt4 = await tx4.wait()
      expect(receipt4.gasUsed).to.eq(62402)
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

    describe("different tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
          { hashed: hashedUUIDList[1], amount: BigNumber.from(100) },
        ])
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 100)
        await token.approve(manager.address, 100);
        await token2.setBalance(wallet0.address, 100)
        await token2.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
        await manager.addDistribution(token2.address, tree.getHexRoot(), 100, [])
      });

      it("send proper token when user claimed", async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect( ( await token.balanceOf( wallet0.address ) ).toString() ).to.equal("0");
        await manager.claim( 1, 0, uuidList[0], 100, proof0)
        expect( (await token.balanceOf(manager.address)).toString() ).to.equal("0");
        expect( ( await token.balanceOf(wallet0.address) ).toString() ).to.equal("100");
        expect( (await token2.balanceOf(manager.address)).toString() ).to.equal("100");
      });
    });

    describe("same tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
          { hashed: hashedUUIDList[1], amount: BigNumber.from(100) },
        ])
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 100)
        await token.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
        await token.setBalance(wallet0.address, 100)
        await token.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
      });

      it("balance is summed up", async () => {
        expect( (await token.balanceOf(manager.address)).toString() ).to.equal("200");
      });

      it("claim use each campaign token", async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.claim( 1, 0, uuidList[0], 100, proof0)
        await manager.claim( 2, 0, uuidList[0], 100, proof0)
      });

      it("decrease remaining map", async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.claim( 1, 0, uuidList[0], 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(0);
        expect(await manager.remainingAmount("2")).to.equal(100);
        await manager.claim( 2, 0, uuidList[0], 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(0);
        expect(await manager.remainingAmount("2")).to.equal(0);
      });

      it("claim does not use other campaign's tokens", async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await manager.claim( 1, 0, uuidList[0], 100, proof0)
        const proof1 = tree.getProof(1, hashedUUIDList[1], BigNumber.from(100))
        await expect(
            manager.connect(wallet1).claim( 1, 1, uuidList[1], 100, proof1)
        ).to.be.revertedWith("MerkleDistributor: Insufficient token.");
      });
    });
  });

  describe("multiple distribution 2", () => {
    let manager: Contract
    let tree: BalanceTree
    let uuidList = [
      '42330217-bdab-440d-9500-2bb253ce547f',
      '89a11414-839a-4719-a8d9-d7774fbaf3c4'
    ]
    let hashedUUIDList = uuidList.map(uuid =>
        utils.solidityKeccak256(["string"], [uuid])
    )

    describe("same tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
          { hashed: hashedUUIDList[1], amount: BigNumber.from(100) },
        ])
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 1000)
        await token.approve(manager.address, 1000);
        await manager.addDistribution(token.address, tree.getHexRoot(), 1000, [])
        await token.setBalance(wallet0.address, 1000)
        await token.approve(manager.address, 1000);
        await manager.addDistribution(token.address, tree.getHexRoot(), 1000, [])
      });

      it("decrease remaining map", async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        const proof1 = tree.getProof(1, hashedUUIDList[1], BigNumber.from(100))
        await manager.claim( 1, 0, uuidList[0], 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(900);
        expect(await manager.remainingAmount("2")).to.equal(1000);

        await manager.claim( 1, 1, uuidList[1], 100, proof1)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(1000);

        await manager.claim( 2, 0, uuidList[0], 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(900);

        await manager.claim( 2, 1, uuidList[1], 100, proof1)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(800);
      });
    });
  });
})
