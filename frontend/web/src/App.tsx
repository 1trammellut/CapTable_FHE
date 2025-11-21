import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface ShareholderData {
  id: number;
  name: string;
  shares: string;
  percentage: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface CapTableStats {
  totalShares: number;
  totalShareholders: number;
  verifiedData: number;
  avgOwnership: number;
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
    status: "pending" as const, 
    message: "" 
  });
  const [newShareholderData, setNewShareholderData] = useState({ name: "", shares: "", percentage: "" });
  const [selectedShareholder, setSelectedShareholder] = useState<ShareholderData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ shares: number | null; percentage: number | null }>({ shares: null, percentage: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;
  const [stats, setStats] = useState<CapTableStats>({
    totalShares: 0,
    totalShareholders: 0,
    verifiedData: 0,
    avgOwnership: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed." 
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
      let totalShares = 0;
      let verifiedCount = 0;
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const shareholder: ShareholderData = {
            id: parseInt(businessId.replace('shareholder-', '')) || Date.now(),
            name: businessData.name,
            shares: businessId,
            percentage: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          };
          
          shareholdersList.push(shareholder);
          
          if (shareholder.isVerified && shareholder.decryptedValue) {
            totalShares += shareholder.decryptedValue;
            verifiedCount++;
          }
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setShareholders(shareholdersList);
      
      setStats({
        totalShares,
        totalShareholders: shareholdersList.length,
        verifiedData: verifiedCount,
        avgOwnership: shareholdersList.length > 0 ? totalShares / shareholdersList.length : 0
      });
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
        "Shareholder Equity Record"
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
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingShareholder(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
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
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
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
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      const tx = await contract.isAvailable();
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract call failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredShareholders = shareholders.filter(shareholder =>
    shareholder.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredShareholders.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentShareholders = filteredShareholders.slice(startIndex, startIndex + itemsPerPage);

  const renderStatsDashboard = () => {
    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Shares</h3>
          <div className="stat-value">{stats.totalShares.toLocaleString()}</div>
          <div className="stat-trend">FHE Protected</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Shareholders</h3>
          <div className="stat-value">{stats.totalShareholders}</div>
          <div className="stat-trend">Registered</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedData}/{stats.totalShareholders}</div>
          <div className="stat-trend">On-chain Verified</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Ownership</h3>
          <div className="stat-value">{stats.avgOwnership.toFixed(1)}%</div>
          <div className="stat-trend">Per Shareholder</div>
        </div>
      </div>
    );
  };

  const renderOwnershipChart = () => {
    const verifiedShareholders = shareholders.filter(s => s.isVerified && s.decryptedValue);
    if (verifiedShareholders.length === 0) {
      return (
        <div className="no-data-chart">
          <p>No verified ownership data available</p>
          <p>Add and verify shareholders to see the chart</p>
        </div>
      );
    }

    return (
      <div className="ownership-chart">
        <div className="chart-container">
          {verifiedShareholders.map((shareholder, index) => (
            <div key={shareholder.id} className="chart-item">
              <div className="chart-bar-container">
                <div 
                  className="chart-bar neon-bar"
                  style={{ height: `${(shareholder.decryptedValue! / stats.totalShares) * 100}%` }}
                >
                  <span className="bar-value">{shareholder.decryptedValue}</span>
                </div>
              </div>
              <div className="chart-label">{shareholder.name}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFHEFlow = () => {
    return (
      <div className="fhe-flow">
        <div className="flow-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>Encrypt Shares</h4>
            <p>Shareholder equity encrypted with FHE</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">📊</div>
          <div className="step-content">
            <h4>Store Securely</h4>
            <p>Encrypted data stored on blockchain</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Authorized Access</h4>
            <p>Only authorized users can decrypt</p>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-step">
          <div className="step-icon">✅</div>
          <div className="step-content">
            <h4>Verify On-chain</h4>
            <p>Proof verification for transparency</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>CapTable FHE 🔐</h1>
            <p>Confidential Equity Management</p>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Cap Table</h2>
            <p>Connect your wallet to initialize the encrypted equity management system</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet securely</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Manage encrypted shareholder equity</p>
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
        <p className="loading-note">Securing equity data with fully homomorphic encryption</p>
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
          <p>Confidential Equity Management</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">
            Test Contract
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + Add Shareholder
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Equity Overview Dashboard</h2>
          {renderStatsDashboard()}
          
          <div className="chart-section">
            <h3>Ownership Distribution</h3>
            {renderOwnershipChart()}
          </div>
          
          <div className="fhe-info-panel">
            <h3>FHE 🔐 Security Flow</h3>
            {renderFHEFlow()}
          </div>
        </div>
        
        <div className="shareholders-section">
          <div className="section-header">
            <h2>Shareholder Management</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search shareholders..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="shareholders-list">
            {currentShareholders.length === 0 ? (
              <div className="no-shareholders">
                <p>No shareholders found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Shareholder
                </button>
              </div>
            ) : currentShareholders.map((shareholder, index) => (
              <div 
                className={`shareholder-item ${selectedShareholder?.id === shareholder.id ? "selected" : ""} ${shareholder.isVerified ? "verified" : ""}`} 
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
                  <span>Ownership: {shareholder.publicValue1}%</span>
                  <span>Added: {new Date(shareholder.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="shareholder-shares">
                  Shares: {shareholder.isVerified ? shareholder.decryptedValue?.toLocaleString() : "🔒 Encrypted"}
                </div>
              </div>
            ))}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
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
            setDecryptedData({ shares: null, percentage: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedShareholder.shares)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
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
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Share quantity will be encrypted with fully homomorphic encryption</p>
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
            <label>Ownership Percentage (1-100) *</label>
            <input 
              type="number" 
              min="1" 
              max="100" 
              name="percentage" 
              value={shareholderData.percentage} 
              onChange={handleChange} 
              placeholder="Enter ownership percentage..." 
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
  decryptedData: { shares: number | null; percentage: number | null };
  setDecryptedData: (value: { shares: number | null; percentage: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ shareholder, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.shares !== null) { 
      setDecryptedData({ shares: null, percentage: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ shares: decrypted, percentage: decrypted });
    }
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
              <span>Added by:</span>
              <strong>{shareholder.creator.substring(0, 6)}...{shareholder.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Added:</span>
              <strong>{new Date(shareholder.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Ownership Percentage:</span>
              <strong>{shareholder.publicValue1}%</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Share Data</h3>
            
            <div className="data-row">
              <div className="data-label">Number of Shares:</div>
              <div className="data-value">
                {shareholder.isVerified && shareholder.decryptedValue ? 
                  `${shareholder.decryptedValue.toLocaleString()} (Verified)` : 
                  decryptedData.shares !== null ? 
                  `${decryptedData.shares.toLocaleString()} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(shareholder.isVerified || decryptedData.shares !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Decrypting..."
                ) : shareholder.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.shares !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Decrypt Shares"
                )}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>FHE Protected Data</strong>
                <p>Share quantities are encrypted on-chain. Click to decrypt with authorized access.</p>
              </div>
            </div>
          </div>
          
          {(shareholder.isVerified || decryptedData.shares !== null) && (
            <div className="equity-summary">
              <h3>Equity Summary</h3>
              <div className="summary-cards">
                <div className="summary-card">
                  <div className="card-value">
                    {shareholder.isVerified ? 
                      shareholder.decryptedValue?.toLocaleString() : 
                      decryptedData.shares?.toLocaleString()
                    }
                  </div>
                  <div className="card-label">Total Shares</div>
                </div>
                <div className="summary-card">
                  <div className="card-value">{shareholder.publicValue1}%</div>
                  <div className="card-label">Ownership</div>
                </div>
                <div className="summary-card">
                  <div className="card-value">
                    {shareholder.isVerified ? '✅' : '🔓'}
                  </div>
                  <div className="card-label">Status</div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!shareholder.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

