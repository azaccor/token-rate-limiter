import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Card,
  Row,
  Col,
  Select,
  Segmented,
  Space,
  Table,
  Tag,
  Progress,
  Typography,
  DatePicker,
  Statistic,
  Empty,
  Spin,
  Badge,
} from "antd";
import {
  WarningOutlined,
  CloseCircleOutlined,
  BarChartOutlined,
  LineChartOutlined,
  AlertOutlined,
  DashboardOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  fetchTimeseries,
  fetchTopConsumers,
  fetchNearLimit,
  fetchGauges,
  fetchModels,
  type TimeseriesPoint,
  type TopConsumer,
  type NearLimitEntry,
  type GaugeEntry,
} from "../lib/api";

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;

// Presets for time range
const TIME_PRESETS = [
  { label: "1h", hours: 1 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "30d", hours: 720 },
];

function autoBucket(hours: number): string {
  if (hours <= 6) return "hour";
  if (hours <= 72) return "hour";
  if (hours <= 720) return "day";
  return "week";
}

export default function MonitoringDashboard() {
  // Filter state
  const [viewBy, setViewBy] = useState<string>("all");
  const [selectedEntity, setSelectedEntity] = useState<string | undefined>();
  const [timeRange, setTimeRange] = useState(168); // hours
  const [customRange, setCustomRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [metric, setMetric] = useState<string>("tokens");
  const [modelFilter, setModelFilter] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);

  // Data state
  const [timeseries, setTimeseries] = useState<TimeseriesPoint[]>([]);
  const [topConsumers, setTopConsumers] = useState<TopConsumer[]>([]);
  const [nearLimit, setNearLimit] = useState<NearLimitEntry[]>([]);
  const [gauges, setGauges] = useState<GaugeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute start/end
  const { startTime, endTime } = useMemo(() => {
    if (customRange) {
      return {
        startTime: customRange[0].toISOString(),
        endTime: customRange[1].toISOString(),
      };
    }
    const end = new Date();
    const start = new Date(end.getTime() - timeRange * 3600000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }, [timeRange, customRange]);

  const bucket = useMemo(() => autoBucket(timeRange), [timeRange]);

  // Load models
  useEffect(() => {
    fetchModels().then(setModels).catch(console.error);
  }, []);

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        start_time: startTime,
        end_time: endTime,
        metric,
        bucket,
      };
      if (selectedEntity) params.user_name = selectedEntity;
      if (modelFilter.length === 1) params.model_name = modelFilter[0];

      const [ts, tc, nl, g] = await Promise.all([
        fetchTimeseries(params),
        fetchTopConsumers({ ...params, limit: "10" }),
        fetchNearLimit(0.9),
        fetchGauges(),
      ]);

      setTimeseries(ts);
      setTopConsumers(tc);
      setNearLimit(nl);
      setGauges(g);
    } catch (err) {
      console.error("Failed to load monitoring data:", err);
    } finally {
      setLoading(false);
    }
  }, [startTime, endTime, metric, bucket, selectedEntity, modelFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Aggregate timeseries for simple display
  const aggregatedTimeseries = useMemo(() => {
    const bucketMap = new Map<string, Map<string, number>>();
    for (const pt of timeseries) {
      if (modelFilter.length > 0 && !modelFilter.includes(pt.model_name))
        continue;
      if (!bucketMap.has(pt.time_bucket))
        bucketMap.set(pt.time_bucket, new Map());
      const modelMap = bucketMap.get(pt.time_bucket)!;
      modelMap.set(
        pt.model_name,
        (modelMap.get(pt.model_name) || 0) + Number(pt.value)
      );
    }
    // Flatten for table display
    const rows: { time: string; model: string; value: number }[] = [];
    for (const [time, modelMap] of Array.from(bucketMap.entries()).sort()) {
      for (const [model, value] of modelMap) {
        rows.push({
          time: dayjs(time).format("YYYY-MM-DD HH:mm"),
          model,
          value: Number(value.toFixed(metric === "dollars" ? 4 : 0)),
        });
      }
    }
    return rows;
  }, [timeseries, modelFilter, metric]);

  // Total usage
  const totalUsage = useMemo(
    () =>
      aggregatedTimeseries.reduce((sum, r) => sum + r.value, 0),
    [aggregatedTimeseries]
  );

  // Unique models in timeseries
  const timeseriesModels = useMemo(
    () => [...new Set(aggregatedTimeseries.map((r) => r.model))],
    [aggregatedTimeseries]
  );

  // Build a simple bar-like table for top consumers
  const maxConsumerValue = useMemo(
    () => Math.max(1, ...topConsumers.map((c) => Number(c.value))),
    [topConsumers]
  );

  const nearLimitColumns = [
    {
      title: "Entity",
      key: "entity",
      render: (_: any, r: NearLimitEntry) => (
        <Space>
          <Tag
            color={
              r.entity_type === "user"
                ? "blue"
                : r.entity_type === "service_principal"
                ? "purple"
                : "green"
            }
          >
            {r.entity_type.replace("_", " ")}
          </Tag>
          <Text strong>{r.entity_name}</Text>
        </Space>
      ),
    },
    { title: "Model", dataIndex: "model_name" },
    {
      title: "Limit",
      key: "limit",
      render: (_: any, r: NearLimitEntry) =>
        r.limit_type === "dollars"
          ? `$${Number(r.limit_value).toLocaleString()}`
          : `${Number(r.limit_value).toLocaleString()} tokens`,
    },
    {
      title: "Used",
      key: "used",
      render: (_: any, r: NearLimitEntry) =>
        r.limit_type === "dollars"
          ? `$${Number(r.used).toFixed(4)}`
          : `${Number(r.used).toLocaleString()} tokens`,
    },
    {
      title: "Usage %",
      key: "pct",
      sorter: (a: NearLimitEntry, b: NearLimitEntry) =>
        a.percentage - b.percentage,
      defaultSortOrder: "descend" as const,
      render: (_: any, r: NearLimitEntry) => (
        <Progress
          percent={r.percentage}
          size="small"
          status={r.status === "exceeded" ? "exception" : "active"}
          strokeColor={r.status === "exceeded" ? "#ff4d4f" : "#faad14"}
        />
      ),
    },
    {
      title: "Status",
      key: "status",
      render: (_: any, r: NearLimitEntry) =>
        r.status === "exceeded" ? (
          <Tag icon={<CloseCircleOutlined />} color="error">
            Exceeded
          </Tag>
        ) : (
          <Tag icon={<WarningOutlined />} color="warning">
            Approaching
          </Tag>
        ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filter Bar */}
      <Card size="small">
        <Space wrap size="middle">
          <Space>
            <Text strong>View:</Text>
            <Segmented
              value={viewBy}
              onChange={(v) => {
                setViewBy(v as string);
                setSelectedEntity(undefined);
              }}
              options={[
                { label: "All", value: "all" },
                { label: "By User/SP", value: "entity" },
              ]}
            />
            {viewBy === "entity" && (
              <Select
                showSearch
                placeholder="Type to search..."
                style={{ width: 240 }}
                value={selectedEntity}
                onChange={setSelectedEntity}
                allowClear
                options={topConsumers.map((c) => ({
                  label: c.user_name,
                  value: c.user_name,
                }))}
              />
            )}
          </Space>

          <Space>
            <Text strong>Range:</Text>
            <Segmented
              value={customRange ? "custom" : String(timeRange)}
              onChange={(v) => {
                if (v === "custom") return;
                setCustomRange(null);
                setTimeRange(Number(v));
              }}
              options={[
                ...TIME_PRESETS.map((p) => ({
                  label: p.label,
                  value: String(p.hours),
                })),
                { label: "Custom", value: "custom" },
              ]}
            />
            {customRange !== null && (
              <RangePicker
                showTime
                value={customRange}
                onChange={(v) => {
                  if (v && v[0] && v[1]) setCustomRange([v[0], v[1]]);
                }}
              />
            )}
          </Space>

          <Space>
            <Text strong>Metric:</Text>
            <Segmented
              value={metric}
              onChange={(v) => setMetric(v as string)}
              options={[
                { label: "Tokens", value: "tokens" },
                { label: "Dollars", value: "dollars" },
              ]}
            />
          </Space>

          <Space>
            <Text strong>Model:</Text>
            <Select
              mode="multiple"
              placeholder="All Models"
              style={{ minWidth: 200 }}
              value={modelFilter}
              onChange={setModelFilter}
              allowClear
              maxTagCount={2}
              options={models.map((m) => ({ label: m, value: m }))}
            />
          </Space>
        </Space>
      </Card>

      {/* Summary Stats */}
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title={`Total ${metric === "dollars" ? "Cost" : "Tokens"}`}
              value={totalUsage}
              precision={metric === "dollars" ? 4 : 0}
              prefix={metric === "dollars" ? "$" : undefined}
              suffix={metric === "tokens" ? "tokens" : undefined}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Active Models"
              value={timeseriesModels.length}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Users Near Limit"
              value={nearLimit.filter((n) => n.status === "approaching").length}
              valueStyle={{ color: "#faad14" }}
              prefix={<WarningOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Users Over Limit"
              value={nearLimit.filter((n) => n.status === "exceeded").length}
              valueStyle={{ color: "#ff4d4f" }}
              prefix={<CloseCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {/* Charts Row */}
      <Row gutter={16}>
        {/* Usage Over Time */}
        <Col span={14}>
          <Card
            title={
              <Space>
                <LineChartOutlined />
                <span>Usage Over Time</span>
              </Space>
            }
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <Spin />
              </div>
            ) : aggregatedTimeseries.length === 0 ? (
              <Empty description="No usage data in this time range" />
            ) : (
              <Table
                dataSource={aggregatedTimeseries}
                columns={[
                  { title: "Time", dataIndex: "time", key: "time" },
                  {
                    title: "Model",
                    dataIndex: "model",
                    key: "model",
                    render: (v) => <Tag>{v}</Tag>,
                  },
                  {
                    title: metric === "dollars" ? "Cost ($)" : "Tokens",
                    dataIndex: "value",
                    key: "value",
                    sorter: (a, b) => a.value - b.value,
                    render: (v) =>
                      metric === "dollars"
                        ? `$${v.toFixed(4)}`
                        : v.toLocaleString(),
                  },
                ]}
                rowKey={(r) => `${r.time}-${r.model}`}
                size="small"
                pagination={{ pageSize: 10 }}
                scroll={{ y: 300 }}
              />
            )}
          </Card>
        </Col>

        {/* Top Consumers */}
        <Col span={10}>
          <Card
            title={
              <Space>
                <BarChartOutlined />
                <span>Top Consumers</span>
              </Space>
            }
          >
            {loading ? (
              <div style={{ textAlign: "center", padding: 40 }}>
                <Spin />
              </div>
            ) : topConsumers.length === 0 ? (
              <Empty description="No usage data" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {topConsumers.map((c) => {
                  const pct = (Number(c.value) / maxConsumerValue) * 100;
                  return (
                    <div key={c.user_name}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 2,
                        }}
                      >
                        <Text
                          ellipsis
                          style={{ maxWidth: 180, fontSize: 13 }}
                        >
                          {c.user_name}
                        </Text>
                        <Text strong style={{ fontSize: 13 }}>
                          {metric === "dollars"
                            ? `$${Number(c.value).toFixed(4)}`
                            : Number(c.value).toLocaleString()}
                        </Text>
                      </div>
                      <div
                        style={{
                          background: "#f0f0f0",
                          borderRadius: 4,
                          height: 8,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            background:
                              "linear-gradient(90deg, #FF3621 0%, #ff6b57 100%)",
                            height: "100%",
                            borderRadius: 4,
                            transition: "width 0.3s",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* Rate Limit Events */}
      <Card
        title={
          <Space>
            <AlertOutlined />
            <span>Rate Limit Events</span>
            <Badge
              count={nearLimit.length}
              overflowCount={99}
              style={{ backgroundColor: nearLimit.some(n => n.status === "exceeded") ? "#ff4d4f" : "#faad14" }}
            />
          </Space>
        }
      >
        <Table
          dataSource={nearLimit}
          columns={nearLimitColumns}
          rowKey={(r) =>
            `${r.entity_name}-${r.model_name}-${r.limit_type}`
          }
          size="middle"
          loading={loading}
          pagination={{ pageSize: 10 }}
          locale={{
            emptyText: (
              <Empty description="No users approaching their limits" />
            ),
          }}
        />
      </Card>

      {/* Usage vs Limit Gauges */}
      <Card
        title={
          <Space>
            <DashboardOutlined />
            <span>Usage vs Limit</span>
          </Space>
        }
      >
        {loading ? (
          <Spin />
        ) : gauges.length === 0 ? (
          <Empty description="No limits configured" />
        ) : (
          <Row gutter={[16, 16]}>
            {gauges.map((g) => (
              <Col key={g.id} xs={24} sm={12} md={8} lg={6}>
                <Card
                  size="small"
                  style={{
                    borderLeft: `3px solid ${
                      g.percentage >= 100
                        ? "#ff4d4f"
                        : g.percentage >= 90
                        ? "#faad14"
                        : "#52c41a"
                    }`,
                  }}
                >
                  <Space direction="vertical" size={4} style={{ width: "100%" }}>
                    <Text strong ellipsis style={{ maxWidth: "100%" }}>
                      {g.entity_name}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {g.model_name} | {g.window_type === "total" ? "Lifetime" : `Per ${g.window_units} ${g.window_type}`}
                    </Text>
                    <Progress
                      percent={g.percentage}
                      size="small"
                      status={
                        g.percentage >= 100
                          ? "exception"
                          : g.percentage >= 90
                          ? "active"
                          : "normal"
                      }
                      strokeColor={
                        g.percentage >= 100
                          ? "#ff4d4f"
                          : g.percentage >= 90
                          ? "#faad14"
                          : "#52c41a"
                      }
                    />
                    <Text style={{ fontSize: 12 }}>
                      {g.limit_type === "dollars"
                        ? `$${g.used.toFixed(4)} / $${Number(g.limit_value).toLocaleString()}`
                        : `${Number(g.used).toLocaleString()} / ${Number(g.limit_value).toLocaleString()} tokens`}
                    </Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </div>
  );
}
