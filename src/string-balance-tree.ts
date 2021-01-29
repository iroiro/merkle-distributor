import MerkleTree from './merkle-tree'
import { BigNumber, utils } from 'ethers'

export default class BalanceTree {
  private readonly tree: MerkleTree
  constructor(balances: { hashed: string; amount: BigNumber }[]) {
    this.tree = new MerkleTree(
      balances.map(({ hashed, amount }, index) => {
        return BalanceTree.toNode(index, hashed, amount)
      })
    )
  }

  public static verifyProof(
    index: number | BigNumber,
    hashed: string,
    amount: BigNumber,
    proof: Buffer[],
    root: Buffer
  ): boolean {
    let pair = BalanceTree.toNode(index, hashed, amount)
    for (const item of proof) {
      pair = MerkleTree.combinedHash(pair, item)
    }

    return pair.equals(root)
  }

  // keccak256(abi.encode(index, account, amount))
  public static toNode(index: number | BigNumber, hashed: string, amount: BigNumber): Buffer {
    return Buffer.from(
      utils.solidityKeccak256(['uint256', 'string', 'uint256'], [index, hashed, amount]).substr(2),
      'hex'
    )
  }

  public getHexRoot(): string {
    return this.tree.getHexRoot()
  }

  // returns the hex bytes32 values of the proof
  public getProof(index: number | BigNumber, hashed: string, amount: BigNumber): string[] {
    return this.tree.getHexProof(BalanceTree.toNode(index, hashed, amount))
  }
}
