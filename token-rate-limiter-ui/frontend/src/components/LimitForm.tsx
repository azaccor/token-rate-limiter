import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Form,
  Select,
  InputNumber,
  Switch,
  Slider,
  Segmented,
  Collapse,
  Table,
  Typography,
  Tooltip,
  Space,
  Tag,
  Button,
  message,
} from "antd";
import {
  InfoCircleOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
} from "@ant-design/icons";
import type { CustomTagProps } from "rc-select/lib/BaseSelect";
import EntitySelect from "./EntitySelect";
import {
  type TokenLimit,
  type ModelPricing,
  updatePricing,
} from "../lib/api";

const { Text } = Typography;

interface Props {
  open: boolean;
  editingLimit: TokenLimit | null;
  models: string[];
  pricing: ModelPricing[];
  onCancel: () => void;
  onSubmit: (values: any) => Promise<void>;
  onPricingUpdated: () => void;
}

const WINDOW_OPTIONS = [
  { label: "Total", value: "total" },
  { label: "Hours", value: "hours" },
  { label: "Days", value: "days" },
  { label: "Weeks", value: "weeks" },
  { label: "Months", value: "months" },
];

function formatWindow(type: string, units: number): string {
  if (type === "total") return "Lifetime total";
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  if (units === 1) return `Every ${type.slice(0, -1)}`;
  return `Every ${units} ${label.toLowerCase()}`;
}

export default function LimitForm({
  open,
  editingLimit,
  models,
  pricing,
  onCancel,
  onSubmit,
  onPricingUpdated,
}: Props) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [editingPricingRow, setEditingPricingRow] = useState<{
    model_name: string;
    input: number;
    output: number;
  } | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);

  const entityType = Form.useWatch("entity_type", form) || "user";
  const limitType = Form.useWatch("limit_type", form) || "tokens";
  const limitValue = Form.useWatch("limit_value", form) || 0;
  const selectedModels: string[] = Form.useWatch("model_names", form) || [];
  const windowType = Form.useWatch("window_type", form) || "total";
  const windowUnits = Form.useWatch("window_units", form) || 1;

  // Get pricing for the first selected model (for conversion display)
  const modelPricing = useMemo(() => {
    const firstModel = selectedModels.find((m) => m !== "__all__");
    if (!firstModel) return null;
    return pricing.find((p) => p.model_name === firstModel) || null;
  }, [selectedModels, pricing]);

  // Compute the conversion display
  const conversionText = useMemo(() => {
    if (!modelPricing || !limitValue) return null;
    const avgPrice =
      (Number(modelPricing.input_price_per_token) +
        Number(modelPricing.output_price_per_token)) /
      2;
    if (limitType === "tokens") {
      const dollars = limitValue * avgPrice;
      return `~ $${dollars.toFixed(4)} (avg input/output pricing)`;
    } else {
      if (avgPrice === 0) return null;
      const tokens = Math.floor(limitValue / avgPrice);
      return `~ ${tokens.toLocaleString()} tokens (avg input/output pricing)`;
    }
  }, [modelPricing, limitValue, limitType]);

  // Handle multi-select mutual exclusivity for __all__
  const handleModelChange = (values: string[]) => {
    if (values.length === 0) {
      form.setFieldValue("model_names", ["__all__"]);
      return;
    }
    const prevValues: string[] = form.getFieldValue("model_names") || [];
    const justSelectedAll =
      values.includes("__all__") && !prevValues.includes("__all__");
    const justSelectedSpecific =
      values.some((v) => v !== "__all__") &&
      prevValues.includes("__all__") &&
      values.includes("__all__");

    if (justSelectedAll) {
      form.setFieldValue("model_names", ["__all__"]);
    } else if (justSelectedSpecific) {
      form.setFieldValue(
        "model_names",
        values.filter((v) => v !== "__all__")
      );
    } else {
      form.setFieldValue("model_names", values);
    }
  };

  const tagRender = (props: CustomTagProps) => {
    const { label, closable, onClose } = props;
    return (
      <Tag
        closable={closable}
        onClose={onClose}
        style={{ marginInlineEnd: 4 }}
      >
        {label}
      </Tag>
    );
  };

  useEffect(() => {
    if (open) {
      if (editingLimit) {
        form.setFieldsValue({
          ...editingLimit,
          model_names: [editingLimit.model_name ?? "__all__"],
        });
      } else {
        form.resetFields();
        form.setFieldsValue({
          entity_type: "user",
          limit_type: "tokens",
          window_type: "total",
          window_units: 1,
          override: false,
          limit_value: 100000,
          model_names: ["__all__"],
        });
      }
      setEditingPricingRow(null);
    }
  }, [open, editingLimit, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await onSubmit(values);
      form.resetFields();
    } catch {
      // validation errors
    } finally {
      setSubmitting(false);
    }
  };

  // Pricing table - save handler
  const handlePricingSave = async () => {
    if (!editingPricingRow) return;
    setSavingPricing(true);
    try {
      await updatePricing(editingPricingRow.model_name, {
        input_price_per_token: editingPricingRow.input,
        output_price_per_token: editingPricingRow.output,
      });
      message.success(
        `Pricing updated for ${editingPricingRow.model_name}`
      );
      setEditingPricingRow(null);
      onPricingUpdated();
    } catch (err: any) {
      message.error(`Failed to update pricing: ${err.message}`);
    } finally {
      setSavingPricing(false);
    }
  };

  // Pricing table columns with inline editing
  const pricingColumns = [
    { title: "Model", dataIndex: "model_name", key: "model_name" },
    {
      title: "Input ($/token)",
      dataIndex: "input_price_per_token",
      key: "input",
      render: (v: number, record: ModelPricing) => {
        if (
          editingPricingRow &&
          editingPricingRow.model_name === record.model_name
        ) {
          return (
            <InputNumber
              size="small"
              value={editingPricingRow.input}
              step={0.000000001}
              precision={10}
              style={{ width: "100%" }}
              onChange={(val) =>
                setEditingPricingRow((prev) =>
                  prev ? { ...prev, input: val ?? 0 } : prev
                )
              }
            />
          );
        }
        return `$${Number(v).toFixed(12)}`;
      },
    },
    {
      title: "Output ($/token)",
      dataIndex: "output_price_per_token",
      key: "output",
      render: (v: number, record: ModelPricing) => {
        if (
          editingPricingRow &&
          editingPricingRow.model_name === record.model_name
        ) {
          return (
            <InputNumber
              size="small"
              value={editingPricingRow.output}
              step={0.000000001}
              precision={10}
              style={{ width: "100%" }}
              onChange={(val) =>
                setEditingPricingRow((prev) =>
                  prev ? { ...prev, output: val ?? 0 } : prev
                )
              }
            />
          );
        }
        return `$${Number(v).toFixed(12)}`;
      },
    },
    {
      title: "Actions",
      key: "actions",
      width: 80,
      render: (_: any, record: ModelPricing) => {
        if (
          editingPricingRow &&
          editingPricingRow.model_name === record.model_name
        ) {
          return (
            <Space>
              <Button
                type="text"
                size="small"
                icon={<CheckOutlined />}
                loading={savingPricing}
                onClick={handlePricingSave}
              />
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setEditingPricingRow(null)}
              />
            </Space>
          );
        }
        return (
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() =>
              setEditingPricingRow({
                model_name: record.model_name,
                input: Number(record.input_price_per_token),
                output: Number(record.output_price_per_token),
              })
            }
          />
        );
      },
    },
  ];

  const modelOptions = [
    { label: "All Models", value: "__all__" },
    ...models.map((m) => ({ label: m, value: m })),
  ];

  return (
    <Modal
      title={editingLimit ? "Edit Limit" : "Create Limit"}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      confirmLoading={submitting}
      width={640}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {/* Entity Type */}
        <Form.Item
          name="entity_type"
          label="Entity Type"
          rules={[{ required: true }]}
        >
          <Select
            options={[
              { label: "User", value: "user" },
              { label: "Service Principal", value: "service_principal" },
              { label: "Group", value: "group" },
            ]}
          />
        </Form.Item>

        {/* Entity Name */}
        <Form.Item
          name="entity_name"
          label="Entity Name"
          rules={[{ required: true, message: "Please select an entity" }]}
        >
          <EntitySelect entityType={entityType} />
        </Form.Item>

        {/* Model - Multi-select */}
        <Form.Item
          name="model_names"
          label="Model"
          initialValue={["__all__"]}
          rules={[
            {
              required: true,
              message: "Please select at least one model",
              type: "array",
              min: 1,
            },
          ]}
        >
          <Select
            mode="multiple"
            optionFilterProp="label"
            options={modelOptions}
            tagRender={tagRender}
            onChange={handleModelChange}
            placeholder="Select models..."
          />
        </Form.Item>

        {/* Limit Type toggle */}
        <Form.Item name="limit_type" label="Limit Type">
          <Segmented
            options={[
              { label: "Tokens", value: "tokens" },
              { label: "Dollars", value: "dollars" },
            ]}
          />
        </Form.Item>

        {/* Limit Value with slider */}
        <Form.Item
          name="limit_value"
          label={
            <Space>
              <span>Limit Value</span>
              {conversionText && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {conversionText}
                </Text>
              )}
            </Space>
          }
          rules={[{ required: true }]}
        >
          <InputNumber
            style={{ width: "100%" }}
            min={0}
            step={limitType === "dollars" ? 0.01 : 1000}
            formatter={(v) =>
              limitType === "dollars"
                ? `$ ${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                : `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
            }
          />
        </Form.Item>
        <Form.Item noStyle>
          <Slider
            min={0}
            max={limitType === "dollars" ? 1000 : 10000000}
            step={limitType === "dollars" ? 1 : 10000}
            value={limitValue}
            onChange={(v) => form.setFieldValue("limit_value", v)}
            tooltip={{ formatter: (v) => (limitType === "dollars" ? `$${v}` : `${v?.toLocaleString()} tokens`) }}
          />
        </Form.Item>

        {/* Time Window */}
        <Form.Item name="window_type" label="Time Window">
          <Segmented options={WINDOW_OPTIONS} />
        </Form.Item>

        {windowType !== "total" && (
          <Form.Item
            name="window_units"
            label={
              <Space>
                <span>Window Size</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {formatWindow(windowType, windowUnits)}
                </Text>
              </Space>
            }
          >
            <InputNumber min={1} max={365} style={{ width: "100%" }} />
          </Form.Item>
        )}

        {/* Override */}
        {(entityType === "user" || entityType === "service_principal") && (
          <Form.Item
            name="override"
            valuePropName="checked"
            label={
              <Space>
                <span>Override</span>
                <Tooltip title="When enabled, ONLY this limit applies for this entity. All group and all-model aggregate limits are ignored.">
                  <InfoCircleOutlined style={{ color: "#999" }} />
                </Tooltip>
              </Space>
            }
          >
            <Switch />
          </Form.Item>
        )}

        {/* Advanced Settings */}
        <Collapse
          ghost
          items={[
            {
              key: "advanced",
              label: "Advanced Settings - Model Pricing",
              children: (
                <Table
                  dataSource={pricing}
                  columns={pricingColumns}
                  rowKey="model_name"
                  size="small"
                  pagination={{ pageSize: 10 }}
                  scroll={{ y: 300 }}
                />
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
