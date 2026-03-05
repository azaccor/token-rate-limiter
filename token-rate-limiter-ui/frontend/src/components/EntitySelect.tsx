import { useState, useEffect, useMemo } from "react";
import { Select, Spin } from "antd";
import { fetchUsers, fetchServicePrincipals, fetchGroups } from "../lib/api";

interface Props {
  entityType: string;
  value?: string;
  onChange?: (value: string) => void;
}

export default function EntitySelect({ entityType, value, onChange }: Props) {
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    setOptions([]);

    const load = async () => {
      try {
        if (entityType === "user") {
          const users = await fetchUsers(search);
          setOptions(
            users.map((u) => ({
              label: u.displayName
                ? `${u.displayName} (${u.email || u.userName})`
                : u.email || u.userName,
              value: u.email || u.userName,
            }))
          );
        } else if (entityType === "service_principal") {
          const sps = await fetchServicePrincipals(search);
          setOptions(
            sps.map((sp) => ({
              label: sp.displayName
                ? `${sp.displayName} (${sp.applicationId})`
                : sp.applicationId,
              value: sp.displayName || sp.applicationId,
            }))
          );
        } else if (entityType === "group") {
          const groups = await fetchGroups(search);
          setOptions(
            groups.map((g) => ({
              label: g.displayName,
              value: g.displayName,
            }))
          );
        }
      } catch (err) {
        console.error("Failed to load entities:", err);
      } finally {
        setLoading(false);
      }
    };

    const timer = setTimeout(load, 300);
    return () => clearTimeout(timer);
  }, [entityType, search]);

  return (
    <Select
      showSearch
      value={value}
      onChange={onChange}
      onSearch={setSearch}
      filterOption={false}
      placeholder={`Select ${entityType.replace("_", " ")}`}
      loading={loading}
      notFoundContent={loading ? <Spin size="small" /> : "No results"}
      options={options}
      style={{ width: "100%" }}
      allowClear
    />
  );
}
