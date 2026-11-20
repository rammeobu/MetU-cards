import { TripPhotosPage } from "@/components/trips/photos/TripPhotosPage";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TripPhotosRoute({ params }: Props) {
  const { id } = await params;
  return <TripPhotosPage tripId={id} />;
}
