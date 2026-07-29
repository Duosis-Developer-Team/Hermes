import { Modal, Button, Typography } from 'antd';
import { DeleteOutlined, WarningOutlined, StopOutlined } from '@ant-design/icons';
import './DeleteModal.css';

const { Text, Title } = Typography;

/**
 * Premium Delete Confirmation Modal
 * Supports both Soft Delete (Deactivate) and Hard Delete (Permanent) modes.
 * 
 * @param {boolean} open - Modal visibility
 * @param {boolean} isActive - If true, shows "Deactivate" mode. If false, shows "Delete" mode.
 * @param {string} itemName - Name of the item
 * @param {function} onConfirm - Callback
 * @param {function} onCancel - Callback
 * @param {boolean} loading - Loading state
 */
const DeleteModal = ({
    open,
    isActive = false, // Default to false (delete mode) if not specified
    itemName,
    onConfirm,
    onCancel,
    loading = false
}) => {
    // Mode Logic
    const isDeactivateMode = isActive === true;

    const title = isDeactivateMode ? 'Archive / Deactivate?' : 'Delete Permanently?';

    // We use a more generic description if not provided, but let's hardcode the logic as requested
    const description = isDeactivateMode
        ? "This item is currently active. Archiving it will preserve existing logs but hide it from future selection."
        : "This item is already inactive. Do you want to permanently delete it? This action CANNOT be undone and may fail if data exists.";

    const buttonText = isDeactivateMode ? 'Archive' : 'Delete Permanently';
    // Use orange for archive, red for delete
    const buttonIcon = isDeactivateMode ? <StopOutlined /> : <DeleteOutlined />;
    // For archive we might want a different style, maybe default or specific class, but let's stick to simple props first.
    // Actually user used "Archive" in plan.

    return (
        <Modal
            open={open}
            onCancel={onCancel}
            footer={null}
            closable={false}
            centered
            className="delete-modal"
            width={420}
        >
            <div className="delete-modal-content">
                <div className={`delete-icon-wrapper ${isDeactivateMode ? 'archive' : 'delete'}`}>
                    {isDeactivateMode ? <StopOutlined className="delete-icon" /> : <WarningOutlined className="delete-icon" />}
                </div>

                <Title level={4} className="delete-title">{title}</Title>

                <div className="delete-description">
                    <Text type="secondary">{description}</Text>
                    {itemName && (
                        <div className="delete-item-name">
                            <Text strong>{itemName}</Text>
                        </div>
                    )}
                </div>

                <div className="delete-actions">
                    <Button
                        onClick={onCancel}
                        disabled={loading}
                        className="cancel-btn"
                    >
                        Cancel
                    </Button>
                    <Button
                        type={isDeactivateMode ? "default" : "primary"}
                        danger={!isDeactivateMode}
                        onClick={onConfirm}
                        loading={loading}
                        icon={buttonIcon}
                        className={`delete-btn ${isDeactivateMode ? 'archive-btn' : ''}`}
                        style={isDeactivateMode ? { borderColor: '#faad14', color: '#faad14' } : {}}
                    >
                        {buttonText}
                    </Button>
                </div>
            </div>

            {/* Inline styles for the specific Archive mode coloring if needed, though CSS is better. 
                I'll assume basic AntD styles + local overrides. */}
            <style>{`
                .delete-icon-wrapper.archive {
                    background: rgba(250, 173, 20, 0.1);
                }
                .delete-icon-wrapper.archive .delete-icon {
                    color: #faad14;
                }
                .archive-btn:hover {
                    color: #d48806 !important;
                    border-color: #d48806 !important;
                }
            `}</style>
        </Modal>
    );
};

export default DeleteModal;
