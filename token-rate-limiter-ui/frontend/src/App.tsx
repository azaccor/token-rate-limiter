import { useState } from "react";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { Layout, Menu, Typography } from "antd";
import {
  SafetyCertificateOutlined,
  DashboardOutlined,
  ControlOutlined,
} from "@ant-design/icons";
import LimitManager from "./pages/LimitManager";
import MonitoringDashboard from "./pages/MonitoringDashboard";

const { Sider, Content, Header } = Layout;
const { Title } = Typography;

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const selectedKey = location.pathname.startsWith("/monitoring")
    ? "/monitoring"
    : "/limits";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={240}
        style={{
          background: "#1b1b1f",
          borderRight: "1px solid #2a2a30",
        }}
      >
        <div
          style={{
            padding: collapsed ? "20px 8px" : "20px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderBottom: "1px solid #2a2a30",
            minHeight: 64,
          }}
        >
          <SafetyCertificateOutlined
            style={{ fontSize: 24, color: "#FF3621" }}
          />
          {!collapsed && (
            <Title
              level={5}
              style={{
                margin: 0,
                color: "#fff",
                whiteSpace: "nowrap",
                fontSize: 15,
              }}
            >
              Token Rate Limiter
            </Title>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => navigate(key)}
          style={{
            background: "transparent",
            borderRight: 0,
            marginTop: 8,
          }}
          theme="dark"
          items={[
            {
              key: "/limits",
              icon: <ControlOutlined />,
              label: "Limit Manager",
            },
            {
              key: "/monitoring",
              icon: <DashboardOutlined />,
              label: "Monitoring",
            },
          ]}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            padding: "0 24px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            height: 64,
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            {selectedKey === "/limits" ? "Limit Manager" : "Monitoring Dashboard"}
          </Title>
        </Header>
        <Content
          style={{
            margin: 24,
            background: "#f5f5f5",
            minHeight: 280,
          }}
        >
          <Routes>
            <Route path="/limits" element={<LimitManager />} />
            <Route path="/monitoring" element={<MonitoringDashboard />} />
            <Route path="*" element={<Navigate to="/limits" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}
