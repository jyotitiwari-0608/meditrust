import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDB(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Copy server/.env.example to server/.env and add your Atlas connection string.'
    );
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  const { name, host } = mongoose.connection;
  console.log(`MongoDB connected: ${host}/${name}`);
  return mongoose.connection;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
