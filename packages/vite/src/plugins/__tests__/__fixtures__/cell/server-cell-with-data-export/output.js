import { createServerCell } from "@cedarjs/web/dist/components/cell/createServerCell";export const data = async ({ id }) => {
  return { user: { id, name: 'John' } };
};

export const Loading = () => <div>Loading...</div>;
export const Success = ({ user }) => <div>{user.name}</div>;const ServerUserCell = createServerCell({ data, Loading, Success, displayName: "ServerUserCell" });export default ServerUserCell;
