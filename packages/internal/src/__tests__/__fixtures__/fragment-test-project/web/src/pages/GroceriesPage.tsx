import { Metadata, useQuery } from '@cedarjs/web';

const GET_GROCERIES = gql`
  query GetGroceries {
    groceries {
      ...Fruit_info
      ...Vegetable_info
    }
  }
`;

const GET_PRODUCE = gql`
  query GetProduce {
    produces {
      ...Produce_info
    }
  }
`;

const GroceriesPage = () => {
  const { data: groceryData, loading: groceryLoading } =
    useQuery(GET_GROCERIES)
  const { data: produceData, loading: produceLoading } =
    useQuery(GET_PRODUCE)

  return (
    <div className="m-12">
      <Metadata title="Groceries" description="Groceries page" og />

      <div className="grid auto-cols-auto gap-4 grid-cols-4">
        {!groceryLoading &&
          groceryData.groceries.map((fruit: { id: string, name: string }) => (
            <div key={fruit.id}>
              {fruit.id} {fruit.name}
            </div>
          ))}

        {!groceryLoading &&
          groceryData.groceries.map(
            (vegetable: { id: string, name: string }) => (
              <div key={vegetable.id}>
                {vegetable.id} {vegetable.name}
              </div>
            )
          )}

        {!produceLoading &&
          produceData.produces?.map((produce: { id: string, name: string }) => (
            <div key={produce.id}>
              {produce.id} {produce.name}
            </div>
          ))}
      </div>
    </div>
  )
}

export default GroceriesPage
