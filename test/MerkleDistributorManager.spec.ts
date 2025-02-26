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

describe('MerkleDistributorManager', () => {
  let wallets: Signer[]
  let wallet0: Signer, wallet1: Signer;
  let managerFactory: ContractFactory

  let token: Contract
  let token2: Contract
  let falsyToken: Contract

  beforeEach('deploy token', async () => {
    managerFactory = await ethers.getContractFactory("MerkleDistributorManager");
    const Token = await ethers.getContractFactory("TestERC20");
    token = await Token.deploy("Token", "TKN", 0);
    token2 = await Token.deploy("Token2", "TKN2", 0);
    const FalsyToken = await ethers.getContractFactory("FalsyTestERC20");
    falsyToken = await FalsyToken.deploy("FalsyToken", "FLS", 0);
    wallets = await ethers.getSigners();
    [wallet0, wallet1] = wallets
  })

  it('fails for no approve', async () => {
    const manager = await managerFactory.deploy()
    await expect(manager.addDistribution(token.address, ZERO_BYTES32, 1, []))
            .to.be.revertedWith( 'ERC20: transfer amount exceeds balance' )
  })

  describe('#distributionId', () => {
    it('increment when distribution is added', async () => {
      const manager = await managerFactory.deploy()
      await token.setBalance(await wallet0.getAddress(), 3)
      await token.approve(manager.address, 3)
      expect(await manager.nextDistributionId()).to.eq(1)
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.nextDistributionId()).to.eq(2)
    })
  })

  describe('#token', () => {
    it('returns the token address', async () => {
      const manager = await managerFactory.deploy()
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.token(1)).to.eq(token.address)
      await manager.addDistribution(token2.address, ONE_BYTES32, 0, [])
      expect(await manager.token(2)).to.eq(token2.address)
    })
  })

  describe('#merkleRoot', () => {
    it('returns the merkle root', async () => {
      const manager = await managerFactory.deploy()
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.merkleRoot(1)).to.eq(ZERO_BYTES32)
      await manager.addDistribution(token.address, ONE_BYTES32, 0, [])
      expect(await manager.merkleRoot(2)).to.eq(ONE_BYTES32)
    })
  })

  describe('#remainingAmount', () => {
    it('returns the remaining amount', async () => {
      const manager = await managerFactory.deploy()
      await manager.addDistribution(token.address, ZERO_BYTES32, 0, [])
      expect(await manager.remainingAmount(1)).to.eq(0)
      await token.setBalance(await wallet0.getAddress(), 1)
      await token.approve(manager.address, 1)
      await manager.addDistribution(token.address, ONE_BYTES32, 1, [])
      expect(await manager.remainingAmount(2)).to.eq(1)
    })
  })

  describe('#claim', () => {
    it('fails for empty proof', async () => {
      const manager = await managerFactory.deploy()
      await token.setBalance(await wallet0.getAddress(), 10)
      await token.approve(manager.address, 10)
      await manager.addDistribution(token.address, ZERO_BYTES32, 10, [])
      await expect(manager.claim(1, 0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
      )
    })

    it('fails for invalid index', async () => {
      const manager = await managerFactory.deploy()
      await token.setBalance(await wallet0.getAddress(), 10)
      await token.approve(manager.address, 10)
      await manager.addDistribution(token.address, ZERO_BYTES32, 10, [])
      await expect(manager.claim(1, 0, await wallet0.getAddress(), 10, [])).to.be.revertedWith(
        'MerkleDistributor: Invalid proof.'
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
        await token.setBalance(await wallet0.getAddress(), 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, [])
        await falsyToken.setBalance(await wallet0.getAddress(), 201)
        await falsyToken.approve(manager.address, 201)
        await manager.addDistribution(falsyToken.address, tree.getHexRoot(), 201, [])
      })

      it('successful claim', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, await wallet0.getAddress(), 100)
        const proof1 = tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101))
        await expect(manager.claim(1, 1, await wallet1.getAddress(), 101, proof1, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, await wallet1.getAddress(), 101)
      })

      it('transfers the token', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect(await token.balanceOf(await wallet0.getAddress())).to.eq(0)
        await manager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        expect(await token.balanceOf(await wallet0.getAddress())).to.eq(100)
      })

      it('must have enough to transfer', async () => {
        const localmanager = await managerFactory.deploy()
        await token.setBalance(await wallet0.getAddress(), 99)
        await token.approve(localmanager.address, 99)
        await localmanager.addDistribution(token.address, tree.getHexRoot(), 99, [])
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(localmanager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'Insufficient token.'
        )
      })

      it('sets #isClaimed', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect(await manager.isClaimed(1, 0)).to.eq(false)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
        await manager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        expect(await manager.isClaimed(1, 0)).to.eq(true)
        expect(await manager.isClaimed(1, 1)).to.eq(false)
      })

      it('cannot allow two claims', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides)
        await expect(manager.claim(1, 0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      })

      it('cannot claim more than once: 0 and then 1', async () => {
        await manager.claim(
          1,
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )
        await manager.claim(
          1,
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )

        await expect(
          manager.claim(1, 0, await wallet0.getAddress(), 100, tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim more than once: 1 and then 0', async () => {
        await manager.claim(
          1,
          1,
          await wallet1.getAddress(),
          101,
          tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)),
          overrides
        )
        await manager.claim(
          1,
          0,
          await wallet0.getAddress(),
          100,
          tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100)),
          overrides
        )

        await expect(
          manager.claim(1, 1, await wallet1.getAddress(), 101, tree.getProof(1, await wallet1.getAddress(), BigNumber.from(101)), overrides)
        ).to.be.revertedWith('MerkleDistributor: Drop already claimed.')
      })

      it('cannot claim for address other than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.claim(1, 1, await wallet1.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Invalid proof.'
        )
      })

      it('cannot claim more than proof', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.claim(1, 0, await wallet0.getAddress(), 101, proof0, overrides)).to.be.revertedWith(
            'MerkleDistributor: Invalid proof.'
        )
      })

      it('revert if ERC20 contract returns false on transfer', async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await expect(manager.claim(2, 0, await wallet0.getAddress(), 100, proof0, overrides)).to.be.revertedWith(
          'MerkleDistributor: Transfer failed.'
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

        await token.setBalance(await wallet0.getAddress(), 201)
        await token.approve(manager.address, 201)
        await manager.addDistribution(token.address, tree.getHexRoot(), 201, overrides)
      })

      it('claim index 4', async () => {
        const proof = tree.getProof(4, await wallets[4].getAddress(), BigNumber.from(5))
        await expect(manager.claim(1, 4, await wallets[4].getAddress(), 5, proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, await wallets[4].getAddress(), 5)
      })

      it('claim index 9', async () => {
        const proof = tree.getProof(9, await wallets[9].getAddress(), BigNumber.from(10))
        await expect(manager.claim(1, 9, await wallets[9].getAddress(), 10, proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, await wallets[9].getAddress(), 10)
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
        await token.setBalance(await wallet0.getAddress(), constants.MaxUint256)
        await token.approve(manager.address, constants.MaxUint256)
        await manager.addDistribution(token.address, tree.getHexRoot(), constants.MaxUint256, [])
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
          await manager.claim(1, i, await wallet0.getAddress(), 100, proof, overrides)
          await expect(manager.claim(1, i, await wallet0.getAddress(), 100, proof, overrides)).to.be.revertedWith(
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
        [await wallet0.getAddress()]: 200,
        [await wallet1.getAddress()]: 300,
        [await wallets[2].getAddress()]: 250,
      })
      expect(tokenTotal).to.eq('0x02ee') // 750
      claims = innerClaims
      manager = await managerFactory.deploy()
      await token.setBalance(await wallet0.getAddress(), tokenTotal)
      await token.approve(manager.address, tokenTotal)
      await manager.addDistribution(token.address, merkleRoot, tokenTotal, [])
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

    it('all claims work exactly once', async () => {
      for (let account in claims) {
        const claim = claims[account]
        await expect(manager.claim(1, claim.index, account, claim.amount, claim.proof, overrides))
          .to.emit(manager, 'Claimed')
          .withArgs(1, account, claim.amount)
        await expect(manager.claim(1, claim.index, account, claim.amount, claim.proof, overrides)).to.be.revertedWith(
          'MerkleDistributor: Drop already claimed.'
        )
      }
      expect(await token.balanceOf(manager.address)).to.eq(0)
    })
  })

  describe("multiple distribution", () => {
    let manager: Contract
    let tree: BalanceTree
    describe("different tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
          { account: await wallet1.getAddress(), amount: BigNumber.from(100) }
        ])
        manager = await managerFactory.deploy()
        await token.setBalance(await wallet0.getAddress(), 100)
        await token.approve(manager.address, 100);
        await token2.setBalance(await wallet0.getAddress(), 100)
        await token2.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
        await manager.addDistribution(token2.address, tree.getHexRoot(), 100, [])
      });

      it("send proper token when user claimed", async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        expect( ( await token.balanceOf( await wallet0.getAddress() ) ).toString() ).to.equal("0");
        await manager.claim( 1, 0, await wallet0.getAddress(), 100, proof0)
        expect( (await token.balanceOf(manager.address)).toString() ).to.equal("0");
        expect( ( await token.balanceOf(await wallet0.getAddress()) ).toString() ).to.equal("100");
        expect( (await token2.balanceOf(manager.address)).toString() ).to.equal("100");
      });
    });

    describe("same tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
          { account: await wallet1.getAddress(), amount: BigNumber.from(100) }
        ])
        manager = await managerFactory.deploy()
        await token.setBalance(await wallet0.getAddress(), 100)
        await token.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
        await token.setBalance(await wallet0.getAddress(), 100)
        await token.approve(manager.address, 100);
        await manager.addDistribution(token.address, tree.getHexRoot(), 100, [])
      });

      it("balance is summed up", async () => {
        expect( (await token.balanceOf(manager.address)).toString() ).to.equal("200");
      });

      it("claim use each campaign token", async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.claim( 1, 0, await wallet0.getAddress(), 100, proof0)
        await manager.claim( 2, 0, await wallet0.getAddress(), 100, proof0)
      });

      it("decrease remaining map", async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.claim( 1, 0, await wallet0.getAddress(), 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(0);
        expect(await manager.remainingAmount("2")).to.equal(100);
        await manager.claim( 2, 0, await wallet0.getAddress(), 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(0);
        expect(await manager.remainingAmount("2")).to.equal(0);
      });

      it("claim does not use other campaign's tokens", async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        await manager.claim( 1, 0, await wallet0.getAddress(), 100, proof0)
        const proof1 = tree.getProof(1, await wallet1.getAddress(), BigNumber.from(100))
        await expect(
            manager.connect(wallet1).claim( 1, 1, await wallet1.getAddress(), 100, proof1)
        ).to.be.revertedWith("MerkleDistributor: Insufficient token.");
      });
    });
  });

  describe("multiple distribution 2", () => {
    let manager: Contract
    let tree: BalanceTree

    describe("same tokens", () => {
      beforeEach(async () => {
        tree = new BalanceTree([
          { account: await wallet0.getAddress(), amount: BigNumber.from(100) },
          { account: await wallet1.getAddress(), amount: BigNumber.from(100) }
        ])
        manager = await managerFactory.deploy()
        await token.setBalance(await wallet0.getAddress(), 1000)
        await token.approve(manager.address, 1000);
        await manager.addDistribution(token.address, tree.getHexRoot(), 1000, [])
        await token.setBalance(await wallet0.getAddress(), 1000)
        await token.approve(manager.address, 1000);
        await manager.addDistribution(token.address, tree.getHexRoot(), 1000, [])
      });

      it("decrease remaining map", async () => {
        const proof0 = tree.getProof(0, await wallet0.getAddress(), BigNumber.from(100))
        const proof1 = tree.getProof(1, await wallet1.getAddress(), BigNumber.from(100))
        await manager.claim( 1, 0, await wallet0.getAddress(), 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(900);
        expect(await manager.remainingAmount("2")).to.equal(1000);

        await manager.claim( 1, 1, await wallet1.getAddress(), 100, proof1)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(1000);

        await manager.claim( 2, 0, await wallet0.getAddress(), 100, proof0)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(900);

        await manager.claim( 2, 1, await wallet1.getAddress(), 100, proof1)
        expect(await manager.remainingAmount("1")).to.equal(800);
        expect(await manager.remainingAmount("2")).to.equal(800);
      });
    });
  });
})
