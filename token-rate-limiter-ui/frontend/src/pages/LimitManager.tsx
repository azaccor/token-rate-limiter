import { useState, useEffect, useCallback } from "react";
import {
  Card,
  Table,
  Button,
  Tag,
  Space,
  Popconfirm,
  Input,
  message,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  fetchLimits,
  createLimit,
  updateLimit,
  deleteLimit,
  type TokenLimit,
} from "../lib/api";
import { useModels, usePricing } from "../hooks/useModels";
import LimitForm from "../components/LimitForm";

const { Text } = Typography;

const ENTITY_COLORS: Record<string, string> = {
  user: "blue",
  service_principal: "purple",
  group: "green",
};

function formatWindow(type: string, units: number): string {
  if (type === "total") return "Lifetime";
  if (units === 1) return `Per ${type.slice(0, -1)}`;
  return `Per ${units} ${type}`;
}

function formatLimit(type: string, value: number): string {
  if (type === "dollars") return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${Number(value).toLocaleString()} tokens`;
}

export default function LimitManager() {
  const [limits, setLimits] = useState<TokenLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TokenLimit | null>(null);

  const { models } = useModels();
  const { pricing, reload: reloadPricing } = usePricing();

  const loadLimits = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchLimits();
      setLimits(data);
    } catch (err: any) {
      message.error(`Failed to load limits: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLimits();
  }, [loadLimits]);

  const handleCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleEdit = (record: TokenLimit) => {
    setEditing(record);
    setFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteLimit(id);
      message.success("Limit deleted");
      loadLimits();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  const handleSubmit = async (values: any) => {
    try {
      if (editing) {
        // When editing, keep the existing single model_name
        const { model_names, ...rest } = values;
        const modelName = model_names?.[0] === "__all__" ? null : (model_names?.[0] ?? null);
        await updateLimit(editing.id, { ...rest, model_name: modelName });
        message.success("Limit updated");
      } else {
        const { model_names, ...rest } = values;
        if (
          !model_names ||
          model_names.length === 0 ||
          (model_names.length === 1 && model_names[0] === "__all__")
        ) {
          // All Models - single row with model_name = null
          await createLimit({ ...rest, model_name: null });
          message.success("Limit created");
        } else {
          // One row per selected model, in parallel
          await Promise.all(
            model_names.map((m: string) =>
              createLimit({ ...rest, model_name: m })
            )
          );
          message.success(
            `${model_names.length} limit${model_names.length > 1 ? "s" : ""} created`
          );
        }
      }
      setFormOpen(false);
      loadLimits();
    } catch (err: any) {
      message.error(err.message);
    }
  };

  // Filter limits by search
  const filtered = limits.filter((l) => {
    const q = search.toLowerCase();
    return (
      l.entity_name.toLowerCase().includes(q) ||
      l.entity_type.toLowerCase().includes(q) ||
      (l.model_name || "").toLowerCase().includes(q)
    );
  });

  const columns: ColumnsType<TokenLimit> = [
    {
      title: "Entity",
      key: "entity",
      sorter: (a, b) => a.entity_name.localeCompare(b.entity_name),
      render: (_, r) => (
        <Space direction="vertical" size={0}>
          <Space>
            <Tag color={ENTITY_COLORS[r.entity_type] || "default"}>
              {r.entity_type.replace("_", " ")}
            </Tag>
            <Text strong>{r.entity_name}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "Model",
      dataIndex: "model_name",
      sorter: (a, b) =>
        (a.model_name || "").localeCompare(b.model_name || ""),
      render: (v) =>
        v ? <Tag>{v}</Tag> : <Tag color="default">All Models</Tag>,
    },
    {
      title: "Limit",
      key: "limit",
      sorter: (a, b) => Number(a.limit_value) - Number(b.limit_value),
      render: (_, r) => (
        <Text>{formatLimit(r.limit_type, r.limit_value)}</Text>
      ),
    },
    {
      title: "Window",
      key: "window",
      render: (_, r) => formatWindow(r.window_type, r.window_units),
    },
    {
      title: "Override",
      dataIndex: "override",
      render: (v) =>
        v ? <Tag color="orange">Override</Tag> : <Text type="secondary">No</Text>,
    },
    {
      title: "Actions",
      key: "actions",
      width: 120,
      render: (_, r) => (
        <Space>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(r)}
          />
          <Popconfirm
            title="Delete this limit?"
            onConfirm={() => handleDelete(r.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <span>Token Limits</span>
            <Tag>{filtered.length}</Tag>
          </Space>
        }
        extra={
          <Space>
            <Input
              placeholder="Search limits..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              style={{ width: 240 }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              Create Limit
            </Button>
          </Space>
        }
      >
        <Table
          dataSource={filtered}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15, showSizeChanger: true }}
          size="middle"
        />
      </Card>

      <LimitForm
        open={formOpen}
        editingLimit={editing}
        models={models}
        pricing={pricing}
        onCancel={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        onPricingUpdated={reloadPricing}
      />
    </div>
  );
}
