import chai, { expect } from 'chai'
import { solidity, MockProvider, deployContract } from 'ethereum-waffle'
import { Contract, BigNumber, constants } from 'ethers'
import BalanceTree from '../src/balance-tree'

import DistributorManager from '../build/MerkleDistributorManager.json'
import TestERC20 from '../build/TestERC20.json'
import { parseBalanceMap } from '../src/parse-balance-map'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999,
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const ONE_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000001'

describe('MerkleDistributorManager', () => {
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
    it('returns the merkle root', async () => {
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

    describe('two account tree', () => {
      let manager: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree([
          { account: wallet0.address, amount: BigNumber.from(100) },
          { account: wallet1.address, amount: BigNumber.from(101) },
        ])
        manager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, [])
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(manager.claim(1, 0, wallet0.address, 100, proof0, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, 0, wallet0.address, 100)
        const proof1 = tree.getProof(1, wallet1.address, BigNumber.from(101))
        await expect(manager.claim(1, 1, wallet1.address, 101, proof1, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, 1, wallet1.address, 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await token.balanceOf(wallet0.address)).to.eq(0)
        await manager.claim(1, 0, wallet0.address, 100, proof0, overrides)
        expect(await token.balanceOf(wallet0.address)).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const localmanager = await deployContract(wallet0, DistributorManager, [], overrides)
        await token.setBalance(wallet0.address, 99)
        await token.approve(localmanager.address, 99)
        await localmanager.addDistribution(token.address, tree.getHexRoot(), 99, [])
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(localmanager.claim(1, 0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'Insufficient token.'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        expect(await manager.isClaimed(1, 0)).to.eq(false)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
        await manager.claim(1, 0, wallet0.address, 100, proof0, overrides)
        expect(await manager.isClaimed(1, 0)).to.eq(true)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await manager.claim(1, 0, wallet0.address, 100, proof0, overrides)
        await expect(manager.claim(1, 0, wallet0.address, 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await manager.claim(
          1,
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )
        await manager.claim(
          1,
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )

        await expect(
          manager.claim(1, 0, wallet0.address, 100, tree.getProof(0, wallet0.address, BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await manager.claim(
          1,
          1,
          wallet1.address,
          101,
          tree.getProof(1, wallet1.address, BigNumber.from(101)),
          overrides
        )
        await manager.claim(
          1,
          0,
          wallet0.address,
          100,
          tree.getProof(0, wallet0.address, BigNumber.from(100)),
          overrides
        )

        await expect(
          manager.claim(1, 1, wallet1.address, 101, tree.getProof(1, wallet1.address, BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(manager.claim(1, 1, wallet1.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, wallet0.address, BigNumber.from(100))
        await expect(manager.claim(1, 0, wallet0.address, 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('gas', async () => {
        const proof = tree.getProof(0, wallet0.address, BigNumber.from(100))
        const tx = await manager.claim(1, 0, wallet0.address, 100, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(87472)
      })
    })

    describe('larger tree', () => {
      let manager: Contract
      let tree: BalanceTree
      beforeEach('deploy', async () => {
        tree = new BalanceTree(
          wallets.map((wallet, ix) => {
            return { account: wallet.address, amount: BigNumber.from(ix + 1) }
          })
        )
        manager = await deployContract(wallet0, DistributorManager, [], overrides)

        await token.setBalance(wallet0.address, 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, overrides)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, wallets[4].address, BigNumber.from(5))
        await expect(manager.claim(1, 4, wallets[4].address, 5, proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, 4, wallets[4].address, 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        await expect(manager.claim(1, 9, wallets[9].address, 10, proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, 9, wallets[9].address, 10)
      })

      it('gas', async () => {
        const proof = tree.getProof(9, wallets[9].address, BigNumber.from(10))
        const tx = await manager.claim(1, 9, wallets[9].address, 10, proof, overrides)
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(89966)
      })

      it('gas second down about 15k', async () => {
        await manager.claim(
          1,
          0,
          wallets[0].address,
          1,
          tree.getProof(0, wallets[0].address, BigNumber.from(1)),
          overrides
        )
        const tx = await manager.claim(
          1,
          1,
          wallets[1].address,
          2,
          tree.getProof(1, wallets[1].address, BigNumber.from(2)),
          overrides
        )
        const receipt = await tx.wait()
        expect(receipt.gasUsed).to.eq(74946)
      })
    })

    describe('realistic size tree', () => {
      let manager: Contract
      let tree: BalanceTree
      const NUM_LEAVES = 100_000
      const NUM_SAMPLES = 25
      const elements: { account: string; amount: BigNumber }[] = []
      for (let i = 0; i < NUM_LEAVES; i++) {
        const node = { account: wallet0.address, amount: BigNumber.from(100) }
        elements.push(node)
      }
      tree = new BalanceTree(elements)

      it('proof verification works', () => {
        const root = Buffer.from(tree.getHexRoot().slice(2), 'hex')
        for (let i = 0; i < NUM_LEAVES; i += NUM_LEAVES / NUM_SAMPLES) {
          const proof = tree
            .getProof(i, wallet0.address, BigNumber.from(100))
            .map((el) => Buffer.from(el.slice(2), 'hex'))
          const validProof = BalanceTree.verifyProof(i, wallet0.address, BigNumber.from(100), proof, root)
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
          const proof = tree.getProof(i, wallet0.address, BigNumber.from(100))
          await manager.claim(1, i, wallet0.address, 100, proof, overrides)
          await expect(manager.claim(1, i, wallet0.address, 100, proof, overrides)).to.be.revertedWith(
            'MerkleDistributor: Drop already claimed.'
          )
        }
      })
    })
  })

  describe('parseBalanceMap', () => {
    let manager: Contract
    let claims: {
      [account: string]: {
        index: number
        amount: string
        proof: string[]
      }
    }
    beforeEach('deploy', async () => {
      const { claims: innerClaims, merkleRoot, tokenTotal } = parseBalanceMap({
        [wallet0.address]: 200,
        [wallet1.address]: 300,
        [wallets[2].address]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      manager = await deployContract(wallet0, DistributorManager, [], overrides)
      await token.setBalance(wallet0.address, tokenTotal)
      await token.approve(manager.address, tokenTotal)
      await manager.addDistribution(token.address, merkleRoot, tokenTotal, [])
    })

    it('check the proofs is as expected', () => {
      expect(claims).to.deep.eq({
        [wallet0.address]: {
          index: 0,
          amount: '0xc8',
          proof: ['0x2a411ed78501edb696adca9e41e78d8256b61cfac45612fa0434d7cf87d916c6'],
        },
        [wallet1.address]: {
          index: 1,
          amount: '0x012c',
          proof: [
            '0xbfeb956a3b705056020a3b64c540bff700c0f6c96c55c0a5fcab57124cb36f7b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
        [wallets[2].address]: {
          index: 2,
          amount: '0xfa',
          proof: [
            '0xceaacce7533111e902cc548e961d77b23a4d8cd073c6b68ccf55c62bd47fc36b',
            '0xd31de46890d4a77baeebddbd77bf73b5c626397b73ee8c69b51efe4c9a5a72fa',
          ],
        },
      })
    })

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(manager.claim(1, claim.index, account, claim.amount, claim.proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, claim.index, account, claim.amount)
        await expect(manager.claim(1, claim.index, account, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(manager.address)).to.eq(0)
    })
  })
})
