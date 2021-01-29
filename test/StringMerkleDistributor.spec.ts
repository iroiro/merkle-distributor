import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import {Contract, BigNumber, constants, utils} from 'ethers'
import BalanceTree from '../src/string-balance-tree'

import Distributor from '../build/StringMerkleDistributor.json'
import TestERC20 from '../build/TestERC20.json'
import { parseStringBalanceMap } from '../src/parse-string-balance-map'
import { v4 as uuidv4 } from "uuid"

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'

const getHashedUUID: () => string = () => {
  return utils.solidityKeccak256(["string"], [uuidv4()])
}

describe('StringMerkleDistributor', () => {
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
  beforeEach('deploy token', async () => {
    token = await deployContract(wallet0, TestERC20, ['Token', 'TKN', 0], overrides)
  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, ZERO_BYTES32], overrides)
      expect(await distributor.token()).to.eq(token.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the zero merkle root', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, ZERO_BYTES32], overrides)
      expect(await distributor.merkleRoot()).to.eq(ZERO_BYTES32)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, ZERO_BYTES32], overrides)
      await expect(distributor.claim(0, getHashedUUID(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const distributor = await deployContract(wallet0, Distributor, [token.address, ZERO_BYTES32], overrides)
      await expect(distributor.claim(0, getHashedUUID(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    describe('two account tree', () => {
      let distributor: Contract
      let tree: BalanceTree
      let uuidList = [...Array(2)].map(_ => uuidv4())
      let hashedUUIDList = uuidList.map(uuid =>
          utils.solidityKeccak256(["string"], [uuid])
      )

      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { hashed: hashedUUIDList[0], amount: BigNumber.from(100) },
          { hashed: hashedUUIDList[1], amount: BigNumber.from(101) },
        ])
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot()], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(0, wallet0.address, 100)

        const proof1 = tree.getProof(1, hashedUUIDList[1], BigNumber.from(101))
        await expect(distributor.connect(wallet1).claim(1, hashedUUIDList[1], 101, proof1, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(1, wallet1.address, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address)).to.eq(0)
        await distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await token.setBalance(distributor.address, 99)
        await expect(distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        expect(await distributor.isClaimed(0)).to.eq(false)
        expect(await distributor.isClaimed(1)).to.eq(false)
        await distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides)
        expect(await distributor.isClaimed(0)).to.eq(true)
        expect(await distributor.isClaimed(1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides)
        await expect(distributor.claim(0, hashedUUIDList[0], 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await distributor.claim(
          0,
          hashedUUIDList[0],
          100,
          tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
          overrides
        )
        await distributor.connect(wallet1).claim(
          1,
          hashedUUIDList[1],
          101,
          tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
          overrides
        )

        await expect(
          distributor.claim(0, hashedUUIDList[0], 100, tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await distributor.connect(wallet1).claim(
          1,
          hashedUUIDList[1],
          101,
          tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)),
          overrides
        )
        await distributor.claim(
          0,
          hashedUUIDList[0],
          100,
          tree.getProof(0, hashedUUIDList[0], BigNumber.from(100)),
          overrides
        )

        await expect(
          distributor.connect(wallet1).claim(1, hashedUUIDList[1], 101, tree.getProof(1, hashedUUIDList[1], BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for uuid hash other than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(distributor.claim(1, wallet1.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        await expect(distributor.claim(0, hashedUUIDList[0], 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        const proof = tree.getProof(0, hashedUUIDList[0], BigNumber.from(100))
        const tx = await distributor.claim(0, hashedUUIDList[0], 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(80187)
      })
    })

    describe('larger tree', () => {
      let distributor: Contract
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
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot()], overrides)
        await token.setBalance(distributor.address, 201)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, hashedUUIDList[4], BigNumber.from(5))
        await expect(distributor.connect(wallets[4]).claim(4, hashedUUIDList[4], 5, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(4, wallets[4].address, 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, hashedUUIDList[9], BigNumber.from(10))
        await expect(distributor.connect(wallets[9]).claim(9, hashedUUIDList[9], 10, proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(9, wallets[9].address, 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, hashedUUIDList[9], BigNumber.from(10))
        const tx = await distributor.connect(wallets[9]).claim(9, hashedUUIDList[9], 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(82640)
      })

      it('gas second down about 15k', async () => {
        await distributor.claim(
          0,
          hashedUUIDList[0],
          1,
          tree.getProof(0, hashedUUIDList[0], BigNumber.from(1)),
          overrides
        )
        const tx = await distributor.connect(wallets[1]).claim(
          1,
          hashedUUIDList[1],
          2,
          tree.getProof(1, hashedUUIDList[1], BigNumber.from(2)),
          overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(67672)
      })
    })

    describe('realistic size tree', () => {
      let distributor: Contract
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
        distributor = await deployContract(wallet0, Distributor, [token.address, tree.getHexRoot()], overrides)
        await token.setBalance(distributor.address, constants.MaxUint256)
      })

      it('gas', async () => {
        const proof = tree.getProof(50000, hashed, BigNumber.from(100))
        const tx = await distributor.claim(50000, hashed, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(93357)
      })

      it('gas deeper node', async () => {
        const proof = tree.getProof(90000, hashed, BigNumber.from(100))
        const tx = await distributor.claim(90000, hashed, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(93367)
      })

      it('gas average random distribution', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree.getProof(i, hashed, BigNumber.from(100))
          const tx = await distributor.claim(i, hashed, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(78684)
      })

      // this is what we gas golfed by packing the bitmap
      it('gas average first 25', async () => {
        let total: BigNumber = BigNumber.from(0)
        let count: number = 0
        for (let i = 0; i < 25; i++) {
          const proof = tree.getProof(i, hashed, BigNumber.from(100))
          const tx = await distributor.claim(i, hashed, 100, proof, overrides)
          const receipt = await tx.wait()
          total = total.add(receipt.gasUsed)
          count++
        }
        const average = total.div(count)
        expect(average).to.eq(64397)
      })

      it('no double claims in random distribution', async () => {
        for (let i = 0; i < 25; i += Math.floor(Math.random() * (NUM_LEAVES / NUM_SAMPLES))) {
          const proof = tree.getProof(i, hashed, BigNumber.from(100))
          await distributor.claim(i, hashed, 100, proof, overrides)
          await expect(distributor.claim(i, hashed, 100, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let distributor: Contract
    let claims: {
      [hashed: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseStringBalanceMap({
        "4fa9ea7f88300d6b059d9a2740941a174e6b46e31da63791c7aae6931ba0a30e": 200,
        "5d424c2b30b8284939101ba18a6addfbfb97c5e5f83c26dda58fc26cdd62c65c": 300,
        "64c9a6016193125075b209cd2053b0b86169e2f4634887bff51fcad3a6b57410": 250
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      distributor = await deployContract(wallet0, Distributor, [token.address, merkleRoot], overrides)
      await token.setBalance(distributor.address, tokenTotal)
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        "4fa9ea7f88300d6b059d9a2740941a174e6b46e31da63791c7aae6931ba0a30e": {
          "index": 0,
          "amount": "0xc8",
          "proof": [
            "0x28fb8f7d010f3b95d5020ec4c2dee94017438b34191a3ec6953e464f5a0159e8",
            "0xdf98f9fac1305b3e7a547327693747bfe46062d7823859752d8d95ef35e632a4"
          ]
        },
        "5d424c2b30b8284939101ba18a6addfbfb97c5e5f83c26dda58fc26cdd62c65c": {
          "index": 1,
          "amount": "0x012c",
          "proof": [
            "0x691ec1a2b329b937919a3410de769341c5fcdd30af894abc0a664bc789f8f99f"
          ]
        },
        "64c9a6016193125075b209cd2053b0b86169e2f4634887bff51fcad3a6b57410": {
          "index": 2,
          "amount": "0xfa",
          "proof": [
            "0xa0ed9686aab061deaeb19e9e8577d4dad5c5b25880729a59563327af0b5af8bc",
            "0xdf98f9fac1305b3e7a547327693747bfe46062d7823859752d8d95ef35e632a4"
          ]
        }
      })
    })

    it('all claims work exactly once', async () => {
      for (let hashed in claims) {
        const claim = claims[hashed]
        await expect(distributor.claim(claim.index, hashed, claim.amount, claim.proof, overrides))
          .to.emit(distributor, 'Claimed')
          .withArgs(claim.index, hashed, claim.amount)
        await expect(distributor.claim(claim.index, hashed, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(distributor.address)).to.eq(0)
    })
  })
})
