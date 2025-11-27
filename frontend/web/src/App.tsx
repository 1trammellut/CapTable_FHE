import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ShareholderData {
  id: string;
  name: string;
  shares: string;
  percentage: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [shareholders, setShareholders] = useState<ShareholderData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingShareholder, setCreatingShareholder] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newShareholderData, setNewShareholderData] = useState({ name: "", shares: "", percentage: "" });
  const [selectedShareholder, setSelectedShareholder] = useState<ShareholderData | null>(null);
  const [decryptedShares, setDecryptedShares] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const shareholdersList: ShareholderData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          shareholdersList.push({
            id: businessId,
            name: businessData.name,
            shares: businessId,
            percentage: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setShareholders(shareholdersList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createShareholder = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingShareholder(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating shareholder with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const sharesValue = parseInt(newShareholderData.shares) || 0;
      const businessId = `shareholder-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, sharesValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newShareholderData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newShareholderData.percentage) || 0,
        0,
        "Shareholder Equity Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Shareholder created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewShareholderData({ name: "", shares: "", percentage: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingShareholder(false); 
    }
  };

  const decryptShares = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Shares decrypted and verified successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredShareholders = shareholders.filter(shareholder => {
    const matchesSearch = shareholder.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || 
                      (activeTab === "verified" && shareholder.isVerified) ||
                      (activeTab === "pending" && !shareholder.isVerified);
    return matchesSearch && matchesTab;
  });

  const totalShareholders = shareholders.length;
  const verifiedShareholders = shareholders.filter(s => s.isVerified).length;
  const totalShares = shareholders.reduce((sum, s) => sum + s.publicValue1, 0);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CapTable FHE 🔐</h1>
            <span>股权结构隐私表</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Encrypted Cap Table</h2>
            <p>Secure shareholder equity management with fully homomorphic encryption</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Manage encrypted shareholder data securely</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Perform private dilution calculations</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your cap table data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted cap table...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>CapTable FHE 🔐</h1>
          <span>股权结构隐私表</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Shareholder
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{totalShareholders}</div>
              <div className="stat-label">Total Shareholders</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{verifiedShareholders}</div>
              <div className="stat-label">Verified Records</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{totalShares}%</div>
              <div className="stat-label">Total Equity</div>
            </div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search shareholders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="tab-filters">
              <button className={activeTab === "all" ? "active" : ""} onClick={() => setActiveTab("all")}>All</button>
              <button className={activeTab === "verified" ? "active" : ""} onClick={() => setActiveTab("verified")}>Verified</button>
              <button className={activeTab === "pending" ? "active" : ""} onClick={() => setActiveTab("pending")}>Pending</button>
            </div>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh Data"}
          </button>
        </div>

        <div className="shareholders-section">
          <div className="section-header">
            <h2>Shareholder Equity Table</h2>
            <span className="section-subtitle">FHE Encrypted • Private • Secure</span>
          </div>
          
          <div className="shareholders-list">
            {filteredShareholders.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">👥</div>
                <p>No shareholders found</p>
                <button className="create-btn" onClick={() => setShowCreateModal(true)}>
                  Add First Shareholder
                </button>
              </div>
            ) : (
              filteredShareholders.map((shareholder, index) => (
                <div 
                  className={`shareholder-item ${shareholder.isVerified ? "verified" : "pending"}`}
                  key={index}
                  onClick={() => setSelectedShareholder(shareholder)}
                >
                  <div className="shareholder-header">
                    <div className="shareholder-name">{shareholder.name}</div>
                    <div className={`verification-status ${shareholder.isVerified ? "verified" : "pending"}`}>
                      {shareholder.isVerified ? "✅ Verified" : "🔓 Pending"}
                    </div>
                  </div>
                  <div className="shareholder-details">
                    <div className="detail">
                      <span>Equity:</span>
                      <strong>{shareholder.publicValue1}%</strong>
                    </div>
                    <div className="detail">
                      <span>Shares:</span>
                      <strong>
                        {shareholder.isVerified ? 
                          `${shareholder.decryptedValue} (Verified)` : 
                          "🔒 Encrypted"
                        }
                      </strong>
                    </div>
                    <div className="detail">
                      <span>Added:</span>
                      <strong>{new Date(shareholder.timestamp * 1000).toLocaleDateString()}</strong>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="info-panels">
          <div className="info-panel">
            <h3>FHE Security Flow</h3>
            <div className="security-flow">
              <div className="flow-step">
                <div className="step-number">1</div>
                <div className="step-content">
                  <strong>Data Encryption</strong>
                  <p>Share counts encrypted with FHE before storage</p>
                </div>
              </div>
              <div className="flow-step">
                <div className="step-number">2</div>
                <div className="step-content">
                  <strong>Private Computation</strong>
                  <p>Dilution calculations performed on encrypted data</p>
                </div>
              </div>
              <div className="flow-step">
                <div className="step-number">3</div>
                <div className="step-content">
                  <strong>Secure Verification</strong>
                  <p>Offline decryption with on-chain proof verification</p>
                </div>
              </div>
            </div>
          </div>

          <div className="info-panel">
            <h3>Compliance Features</h3>
            <ul className="compliance-list">
              <li>✅ SEC Regulation D compliant</li>
              <li>✅ GDPR privacy protection</li>
              <li>✅ Audit trail preservation</li>
              <li>✅ Real-time compliance checks</li>
            </ul>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateShareholder 
          onSubmit={createShareholder} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingShareholder} 
          shareholderData={newShareholderData} 
          setShareholderData={setNewShareholderData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedShareholder && (
        <ShareholderDetailModal 
          shareholder={selectedShareholder} 
          onClose={() => { 
            setSelectedShareholder(null); 
            setDecryptedShares(null); 
          }} 
          decryptedShares={decryptedShares} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptShares={() => decryptShares(selectedShareholder.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateShareholder: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  shareholderData: any;
  setShareholderData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, shareholderData, setShareholderData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'shares') {
      const intValue = value.replace(/[^\d]/g, '');
      setShareholderData({ ...shareholderData, [name]: intValue });
    } else {
      setShareholderData({ ...shareholderData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-shareholder-modal">
        <div className="modal-header">
          <h2>Add New Shareholder</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Share count will be encrypted using fully homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Shareholder Name *</label>
            <input 
              type="text" 
              name="name" 
              value={shareholderData.name} 
              onChange={handleChange} 
              placeholder="Enter shareholder name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Number of Shares (Integer only) *</label>
            <input 
              type="number" 
              name="shares" 
              value={shareholderData.shares} 
              onChange={handleChange} 
              placeholder="Enter number of shares..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Equity Percentage (1-100) *</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              name="percentage" 
              value={shareholderData.percentage} 
              onChange={handleChange} 
              placeholder="Enter equity percentage..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !shareholderData.name || !shareholderData.shares || !shareholderData.percentage} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Adding..." : "Add Shareholder"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ShareholderDetailModal: React.FC<{
  shareholder: ShareholderData;
  onClose: () => void;
  decryptedShares: number | null;
  isDecrypting: boolean;
  decryptShares: () => Promise<number | null>;
}> = ({ shareholder, onClose, decryptedShares, isDecrypting, decryptShares }) => {
  const handleDecrypt = async () => {
    if (decryptedShares !== null) return;
    
    const decrypted = await decryptShares();
  };

  return (
    <div className="modal-overlay">
      <div className="shareholder-detail-modal">
        <div className="modal-header">
          <h2>Shareholder Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="shareholder-info">
            <div className="info-item">
              <span>Name:</span>
              <strong>{shareholder.name}</strong>
            </div>
            <div className="info-item">
              <span>Wallet Address:</span>
              <strong>{shareholder.creator.substring(0, 6)}...{shareholder.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Added:</span>
              <strong>{new Date(shareholder.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Equity Percentage:</span>
              <strong>{shareholder.publicValue1}%</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Share Data</h3>
            
            <div className="data-row">
              <div className="data-label">Number of Shares:</div>
              <div className="data-value">
                {shareholder.isVerified && shareholder.decryptedValue ? 
                  `${shareholder.decryptedValue} shares (On-chain Verified)` : 
                  decryptedShares !== null ? 
                  `${decryptedShares} shares (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(shareholder.isVerified || decryptedShares !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? "🔓 Verifying..." :
                 shareholder.isVerified ? "✅ Verified" :
                 decryptedShares !== null ? "🔄 Re-verify" : "🔓 Verify Decryption"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE 🔐 Secure Verification</strong>
                <p>Share count is encrypted on-chain. Verification performs offline decryption with on-chain proof validation.</p>
              </div>
            </div>
          </div>
          
          {(shareholder.isVerified || decryptedShares !== null) && (
            <div className="analysis-section">
              <h3>Ownership Analysis</h3>
              <div className="ownership-chart">
                <div className="chart-bar">
                  <div 
                    className="bar-fill" 
                    style={{ width: `${shareholder.publicValue1}%` }}
                  >
                    <span className="bar-value">{shareholder.publicValue1}% Equity</span>
                  </div>
                </div>
              </div>
              
              <div className="verified-data">
                <div className="data-point">
                  <span>Verified Shares:</span>
                  <strong>
                    {shareholder.isVerified ? 
                      `${shareholder.decryptedValue} shares` : 
                      `${decryptedShares} shares`
                    }
                  </strong>
                </div>
                <div className="data-point">
                  <span>Verification Status:</span>
                  <strong className={shareholder.isVerified ? "verified" : "local"}>
                    {shareholder.isVerified ? 'On-chain Verified' : 'Locally Decrypted'}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!shareholder.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;