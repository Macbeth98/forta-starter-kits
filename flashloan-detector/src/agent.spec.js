const { FindingType, FindingSeverity, Finding, ethers, Label, EntityType } = require("forta-agent");
const { provideHandleTransaction, provideInitialize, provideHandleBlock } = require("./agent");

const asset = "0xasset";
const initiator = "0xfrom";
const contractCalled = "0xtxnto";
const chain = "ethereum";
const nativeToken = "ethereum";

const amount = ethers.utils.parseEther("100");
const tokenProfit = ethers.utils.parseEther("10");
const nativeProfit = ethers.utils.parseEther("1");

const mockFlashloansKey = "mock-flashloans-bot-key";
const mockFlashloansHighKey = "mock-flashloans-high-profit-bot-key";
const mockTotalTxnsKey = "mock-flashloans-bot-total-txns-key";

const mockDetectedFlashloans = 12;
const mockDetectedHighProfitFlashloans = 2;
const mockTotalTxns = 136;

const lowTokenUsdProfit = 1000;
const lowNativeUsdProfit = 1000;

const highNativeUsdProfit = 200_000;
const hightokenUsdProfit = 200_000;

const veryHighTokenUsdProfit = 1_000_000;

const flashloan = {
  asset,
  amount,
  account: initiator,
};

const mockGetFlashloans = jest.fn();
const mockHelper = {
  zero: ethers.constants.Zero,
  getTransactionReceipt: jest.fn(),
  init: () => ({ chain, nativeToken }),
  calculateBorrowedAmount: jest.fn(),
  calculateTokenProfits: jest.fn(),
  calculateNativeProfit: jest.fn(),
  calculateTokensUsdProfit: jest.fn(),
  calculateNativeUsdProfit: jest.fn(),
  clear: () => {},
};

const mockPersistenceHelper = {
  persist: jest.fn(),
  load: jest.fn(),
};

describe("flashloan detector agent", () => {
  describe("Transaction handler test suite", () => {
    const mockProvider = {
      getCode: jest.fn(),
    };

    let initialize;
    let handleTransaction;

    const mockNativeTransferTrace = {
      action: {
        from: contractCalled,
        to: initiator,
        value: 100,
        callType: "call",
        input: "0x0",
      },
    };

    const mockErc20TransferTrace = {
      action: {
        from: contractCalled,
        to: initiator,
        value: "0x0",
        callType: "call",
        input: "0xa9059cbbDeFi",
      },
    };

    const mockTransferEvent = {
      name: "Transfer",
      args: {
        src: contractCalled,
        dst: initiator,
      },
    };

    beforeEach(async () => {
      initialize = provideInitialize(
        mockHelper,
        mockPersistenceHelper,
        mockFlashloansKey,
        mockFlashloansHighKey,
        mockTotalTxnsKey
      );
      mockPersistenceHelper.load
        .mockReturnValueOnce(mockDetectedFlashloans)
        .mockReturnValueOnce(mockDetectedHighProfitFlashloans)
        .mockReturnValueOnce(mockTotalTxns);
      await initialize();
      handleTransaction = provideHandleTransaction(mockHelper, mockGetFlashloans, mockProvider);
    });

    it("returns empty findings if there are no flashloans", async () => {
      const mockTxEvent = {
        from: initiator,
        to: contractCalled,
        traces: [mockNativeTransferTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      mockGetFlashloans.mockResolvedValueOnce([]);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([]);
    });

    it("returns a finding if there is a flashloan with high native profit", async () => {
      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [mockNativeTransferTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockHighProfitAnomalyScore = (mockDetectedHighProfitFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockHelper.calculateNativeProfit.mockReturnValueOnce(nativeProfit);
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(10000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateNativeUsdProfit.mockResolvedValueOnce(highNativeUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack and made profit > $100000`,
          alertId: "FLASHLOAN-ATTACK-WITH-HIGH-PROFIT",
          severity: FindingSeverity.High,
          type: FindingType.Exploit,
          metadata: {
            profit: highNativeUsdProfit.toFixed(2),
            tokens: [],
            anomalyScore: mockHighProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.9),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateNativeProfit).toHaveBeenCalledWith([mockNativeTransferTrace], initiator);
      expect(mockHelper.calculateNativeUsdProfit).toHaveBeenCalledWith(nativeProfit, chain);
    });

    it("returns a finding if there is a flashloan with high token profit", async () => {
      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [mockErc20TransferTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockHighProfitAnomalyScore = (mockDetectedHighProfitFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockTxEvent.filterLog.mockReturnValueOnce([mockTransferEvent]);
      mockHelper.calculateTokenProfits.mockReturnValueOnce({ [asset]: tokenProfit });
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(10000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateTokensUsdProfit.mockResolvedValueOnce(hightokenUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack and made profit > $100000`,
          alertId: "FLASHLOAN-ATTACK-WITH-HIGH-PROFIT",
          severity: FindingSeverity.High,
          type: FindingType.Exploit,
          metadata: {
            profit: hightokenUsdProfit.toFixed(2),
            tokens: [asset],
            anomalyScore: mockHighProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.9),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateTokenProfits).toHaveBeenCalledWith([mockTransferEvent], initiator);
      expect(mockHelper.calculateTokensUsdProfit).toHaveBeenCalledWith(
        {
          [asset]: tokenProfit,
        },
        chain
      );
    });

    it("returns a finding when there is a flashloan with low token profit but no traces", async () => {
      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockLowProfitAnomalyScore = (mockDetectedFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockTxEvent.filterLog.mockReturnValueOnce([mockTransferEvent]);
      mockProvider.getCode.mockReturnValueOnce("0x");
      mockHelper.calculateTokenProfits.mockReturnValueOnce({ [asset]: tokenProfit });
      mockHelper.calculateNativeProfit.mockReturnValueOnce(0);
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(10000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateTokensUsdProfit.mockResolvedValueOnce(lowTokenUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack`,
          alertId: "FLASHLOAN-ATTACK",
          severity: FindingSeverity.Low,
          type: FindingType.Exploit,
          metadata: {
            profit: lowTokenUsdProfit.toFixed(2),
            tokens: [asset],
            anomalyScore: mockLowProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.6),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockHelper.calculateTokenProfits).toHaveBeenCalledWith([mockTransferEvent], initiator);
      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateTokensUsdProfit).toHaveBeenCalledWith(
        {
          [asset]: tokenProfit,
        },
        chain
      );
    });

    it("returns a finding if there is a flashloan with high token profit and high percentage", async () => {
      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [mockErc20TransferTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockHighProfitAnomalyScore = (mockDetectedHighProfitFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockTxEvent.filterLog.mockReturnValueOnce([mockTransferEvent]);
      mockHelper.calculateTokenProfits.mockReturnValueOnce({ [asset]: tokenProfit });
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(100_000_000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateTokensUsdProfit.mockResolvedValueOnce(veryHighTokenUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack and made profit > $500000`,
          alertId: "FLASHLOAN-ATTACK-WITH-HIGH-PROFIT",
          severity: FindingSeverity.High,
          type: FindingType.Exploit,
          metadata: {
            profit: veryHighTokenUsdProfit.toFixed(2),
            tokens: [asset],
            anomalyScore: mockHighProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.9),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateTokenProfits).toHaveBeenCalledWith([mockTransferEvent], initiator);
      expect(mockHelper.calculateTokensUsdProfit).toHaveBeenCalledWith(
        {
          [asset]: tokenProfit,
        },
        chain
      );
    });

    it("returns a finding if there is a flashloan with low token profit with a different end recipient", async () => {
      const diffEndRecipient = "0xdst";
      const diffMockTransferEvent = {
        name: "Transfer",
        args: {
          src: contractCalled,
          dst: diffEndRecipient,
        },
      };

      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [mockErc20TransferTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockLowProfitAnomalyScore = (mockDetectedFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockTxEvent.filterLog.mockReturnValueOnce([diffMockTransferEvent]);
      mockProvider.getCode.mockReturnValueOnce("0x");
      mockHelper.calculateTokenProfits.mockReturnValueOnce({ [asset]: tokenProfit });
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(10000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateTokensUsdProfit.mockResolvedValueOnce(lowTokenUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack`,
          alertId: "FLASHLOAN-ATTACK",
          severity: FindingSeverity.Low,
          type: FindingType.Exploit,
          metadata: {
            profit: lowTokenUsdProfit.toFixed(2),
            tokens: [asset],
            anomalyScore: mockLowProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.6),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockProvider.getCode).toHaveBeenCalledWith(diffEndRecipient);
      expect(mockHelper.calculateTokenProfits).toHaveBeenCalledWith([diffMockTransferEvent], diffEndRecipient);
      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateTokensUsdProfit).toHaveBeenCalledWith(
        {
          [asset]: tokenProfit,
        },
        chain
      );
    });

    it("returns a finding if there is a flashloan with low native profit with a different end recipient", async () => {
      const diffEndRecipient = "0xdst";
      const mockNativeTransferDiffRecipientTrace = {
        action: {
          from: contractCalled,
          to: diffEndRecipient,
          value: 100,
          callType: "call",
          input: "0x0",
        },
      };

      const mockTxEvent = {
        hash: "mockHash",
        from: initiator,
        to: contractCalled,
        traces: [mockNativeTransferDiffRecipientTrace],
        filterLog: jest.fn(),
        transaction: { gasPrice: 0 },
      };

      // Adding one for both the current transaction and high profit flashloan
      const mockLowProfitAnomalyScore = (mockDetectedFlashloans + 1) / (mockTotalTxns + 1);

      mockGetFlashloans.mockResolvedValueOnce([flashloan]);
      mockProvider.getCode.mockReturnValueOnce("0x");
      mockHelper.calculateNativeProfit.mockReturnValueOnce(nativeProfit);
      mockHelper.calculateBorrowedAmount.mockResolvedValueOnce(10000);
      mockHelper.getTransactionReceipt.mockResolvedValueOnce({ gasUsed: 0 });
      mockHelper.calculateNativeUsdProfit.mockResolvedValueOnce(lowNativeUsdProfit);
      const findings = await handleTransaction(mockTxEvent);

      expect(findings).toStrictEqual([
        Finding.fromObject({
          name: "Flashloan detected",
          description: `${initiator} launched flash loan attack`,
          alertId: "FLASHLOAN-ATTACK",
          severity: FindingSeverity.Low,
          type: FindingType.Exploit,
          metadata: {
            profit: lowNativeUsdProfit.toFixed(2),
            tokens: [],
            anomalyScore: mockLowProfitAnomalyScore.toFixed(2),
          },
          labels: [
            Label.fromObject(EntityType.Address, initiator, "Attacker", 0.6),
            Label.fromObject(EntityType.Transaction, mockTxEvent.hash, "Flashloan Transaction", 1),
          ],
        }),
      ]);

      expect(mockProvider.getCode).toHaveBeenCalledWith(diffEndRecipient);
      expect(mockHelper.calculateNativeProfit).toHaveBeenCalledWith(
        [mockNativeTransferDiffRecipientTrace],
        diffEndRecipient
      );
      expect(mockHelper.calculateBorrowedAmount).toHaveBeenCalledWith(asset, amount, chain);
      expect(mockHelper.calculateNativeUsdProfit).toHaveBeenCalledWith(nativeProfit, chain);
    });
  });

  describe("Block handler test suite", () => {
    beforeEach(async () => {
      initialize = provideInitialize(
        mockHelper,
        mockPersistenceHelper,
        mockFlashloansKey,
        mockFlashloansHighKey,
        mockTotalTxnsKey
      );
      await initialize();
      handleBlock = provideHandleBlock(
        mockPersistenceHelper,
        mockFlashloansKey,
        mockFlashloansHighKey,
        mockTotalTxnsKey
      );
    });
    afterEach(async () => {
      mockPersistenceHelper.persist.mockClear();
    });

    it("should persist the value in a block evenly divisible by 240", async () => {
      const mockBlockEvent = {
        blockNumber: 720,
      };

      await handleBlock(mockBlockEvent);

      expect(mockPersistenceHelper.persist).toHaveBeenCalledTimes(3);
    });

    it("should not persist values because block is not evenly divisible by 240", async () => {
      const mockBlockEvent = {
        blockNumber: 600,
      };

      await handleBlock(mockBlockEvent);

      expect(mockPersistenceHelper.persist).toHaveBeenCalledTimes(0);
    });
  });
});
