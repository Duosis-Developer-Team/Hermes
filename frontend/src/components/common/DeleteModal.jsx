import React from 'react';
import { Modal, Button, Typography, Space } from 'antd';
import { DeleteOutlined, WarningOutlined } from '@ant-design/icons';
import './DeleteModal.css';

const { Text, Title } = Typography;

/**
 * Premium Delete Confirmation Modal
 * 
 * @param {boolean} open - Modal visibility state
 * @param {string} title - Title of the modal (e.g., "Delete Customer")
 * @param {string} description - Description text (e.g., "Are you sure you want to delete this customer? This action cannot be undone.")
 * @param {string} itemName - Optional name of the item being deleted for emphasis (e.g., "Acme Corp")
 * @param {function} onConfirm - Callback function when delete is confirmed
 * @param {function} onCancel - Callback function when modal is cancelled
 * @param {boolean} loading - Loading state for the confirm button
 */
const DeleteModal = ({
    open,
    title = "Delete Item",
    description = "Are you sure you want to delete this item? This action cannot be undone.",
    itemName,
    onConfirm,
    onCancel,
    loading = false
}) => {
    return (
        <Modal
            open={open}
            onCancel={onCancel}
            footer={null}
            closable={false}
            centered
            className="delete-modal"
            width={400}
        >
            <div className="delete-modal-content">
                <div className="delete-icon-wrapper">
                    <WarningOutlined className="delete-icon" />
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
                        type="primary"
                        danger
                        onClick={onConfirm}
                        loading={loading}
                        icon={<DeleteOutlined />}
                        className="delete-btn"
                    >
                        Delete
                    </Button>
                </div>
            </div>
        </Modal>
    );
};

export default DeleteModal;
